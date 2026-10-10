import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { PNG, valid, WEBP } from "../server/sample";
import { recipe, SERVER } from "./doc";

const { doc, block, load, cleanup } = recipe("github-issues.md");

type Route = { POST(request: Request): Promise<Response> };
type Issue = { number: number; title: string; body: string; labels: string[] };

const TOKEN = "github_pat_test_not_real";
const REPO = "acme/app-feedback";

// A fake of GitHub's REST API in place of fetch: it refuses requests without the token and the
// headers GitHub requires, keeps files per branch, and creates files only when no sha is sent.
const files = new Map<string, string>();
const branches = new Set<string>();
const issues: Issue[] = [];
const requests: string[] = [];
let repo = { private: true, default_branch: "main", full_name: REPO };
let failIssue = false;
let failMarker = false;
let conflicts = 0;
const realFetch = globalThis.fetch;

async function fake(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  const headers = new Headers(init.headers);
  const method = init.method ?? "GET";
  requests.push(`${method} ${url.pathname}${url.search}`);
  if (headers.get("authorization") !== `Bearer ${TOKEN}`)
    return new Response(null, { status: 401 });
  if (
    url.origin !== "https://api.github.com" ||
    !["application/vnd.github+json", "application/vnd.github.object"].includes(
      String(headers.get("accept")),
    ) ||
    headers.get("x-github-api-version") !== "2022-11-28"
  ) {
    return new Response(null, { status: 400 });
  }
  const base = `/repos/${REPO}`;
  if (!url.pathname.startsWith(base)) return new Response(null, { status: 404 });
  const path = url.pathname.slice(base.length);
  const body = init.body ? JSON.parse(String(init.body)) : null;
  if (method === "GET" && path === "") return Response.json(repo);
  const file = /^\/contents\/(.+)$/.exec(path)?.[1];
  if (file && method === "GET") {
    if (!branches.has(String(url.searchParams.get("ref"))))
      return new Response(null, { status: 404 });
    const content = files.get(`${url.searchParams.get("ref")}:${file}`);
    if (!content) return new Response(null, { status: 404 });
    // GitHub's plain JSON answer refuses a file over 1 MB; the object one leaves out its content.
    if (headers.get("accept") === "application/vnd.github.object") {
      return Response.json({ content: decode(content).length > 1_000_000 ? "" : content });
    }
    if (decode(content).length > 1_000_000) return new Response(null, { status: 403 });
    return Response.json({ content });
  }
  if (file && method === "PUT") {
    if (failMarker && file.endsWith("report.json")) return new Response(null, { status: 500 });
    if (conflicts > 0) {
      conflicts--;
      return new Response(null, { status: 409 });
    }
    const base64 = typeof body.content === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(body.content);
    if (typeof body.message !== "string" || !body.message || !base64) {
      return new Response(null, { status: 422 });
    }
    // GitHub refuses a branch that does not exist with the same 422 as an existing file.
    if (!branches.has(body.branch)) return new Response(null, { status: 422 });
    const key = `${body.branch}:${file}`;
    if (files.has(key) && !body.sha) return new Response(null, { status: 422 });
    files.set(key, body.content);
    return Response.json({}, { status: 201 });
  }
  if (path === "/issues" && method === "POST") {
    if (failIssue) return new Response(null, { status: 500 });
    // GitHub's limits on an issue: title 256, label name 50, body 65,536 characters.
    const tooLong =
      !body.title ||
      body.title.length > 256 ||
      body.body.length > 65_536 ||
      body.labels.some((label: string) => !label || label.length > 50);
    if (tooLong) return new Response(null, { status: 422 });
    const issue = { number: issues.length + 1, ...body };
    issues.push(issue);
    return Response.json(issue, { status: 201 });
  }
  return new Response(null, { status: 404 });
}

let route: Route;
const saved = { ...process.env };

beforeAll(async () => {
  route = await load<Route>(block("ts"), { "visual-feedback/server": SERVER });
  globalThis.fetch = fake as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  cleanup();
});

beforeEach(() => {
  files.clear();
  issues.length = 0;
  requests.length = 0;
  repo = { private: true, default_branch: "main", full_name: REPO };
  branches.clear();
  branches.add("main").add("visual-feedback");
  failIssue = false;
  failMarker = false;
  conflicts = 0;
  process.env.GITHUB_FEEDBACK_REPO = REPO;
  process.env.GITHUB_FEEDBACK_TOKEN = TOKEN;
  delete process.env.GITHUB_FEEDBACK_BRANCH;
});

afterEach(() => {
  for (const name of ["GITHUB_FEEDBACK_REPO", "GITHUB_FEEDBACK_TOKEN", "GITHUB_FEEDBACK_BRANCH"]) {
    if (name in saved) process.env[name] = saved[name];
    else delete process.env[name];
  }
});

function post(report: Record<string, unknown>, image?: Uint8Array, type = "image/png"): Request {
  const form = new FormData();
  form.append("report", JSON.stringify(report));
  if (image) form.append("image0", new Blob([image as Uint8Array<ArrayBuffer>], { type }), "x");
  return new Request("http://localhost/api/feedback", { method: "POST", body: form });
}

const decode = (content: string | undefined) => Buffer.from(content ?? "", "base64");

for (const [layout, branch] of [
  ["a dedicated private repo, on its default branch", undefined],
  ["the code repo, on the orphan branch", "visual-feedback"],
] as const) {
  it(`in ${layout}, a report becomes one issue with its image, read back`, async () => {
    if (branch) process.env.GITHUB_FEEDBACK_BRANCH = branch;
    const ref = branch ?? "main";
    const report: Record<string, unknown> = { ...valid(), category: "bug" };
    expect((await route.POST(post(report, PNG))).status).toBe(204);
    expect(decode(files.get(`${ref}:feedback/${report.id}/screenshot-0.png`))).toEqual(
      Buffer.from(PNG),
    );
    expect(issues).toHaveLength(1);
    const [issue] = issues as [Issue];
    expect(issue.labels).toEqual(["feedback", "bug"]);
    expect(issue.title).toBe(report.note);
    expect(issue.body).toContain(
      `![Screenshot 1](<https://github.com/${REPO}/blob/${ref}/feedback/${report.id}/screenshot-0.png?raw=true>)`,
    );
    expect(issue.body).toContain(String((report.page as { url: string }).url));
    expect(issue.body).toContain(String(report.userAgent));
    const marker = JSON.parse(
      String(decode(files.get(`${ref}:feedback/${report.id}/report.json`))),
    );
    expect(marker.issue).toBe(1);
    expect(marker.note).toBe(report.note);
    expect(marker.screenshots[0].image).toBe(
      `https://github.com/${REPO}/blob/${ref}/feedback/${report.id}/screenshot-0.png?raw=true`,
    );
    // A resend in this layout opens nothing and replaces nothing.
    const before = new Map(files);
    await route.POST(post({ ...report, note: "forged" }, Uint8Array.of(...PNG, 0)));
    expect(issues).toHaveLength(1);
    expect(files).toEqual(before);
  });

  it(`in ${layout}, a public repo is refused, and nothing is created`, async () => {
    if (branch) process.env.GITHUB_FEEDBACK_BRANCH = branch;
    repo = { ...repo, private: false };
    expect((await route.POST(post(valid(), PNG))).status).toBe(503);
    expect(files.size).toBe(0);
    expect(issues).toEqual([]);
  });
}

it("a WebP report is committed and linked as screenshot-0.webp", async () => {
  const report = valid();
  expect((await route.POST(post(report, WEBP, "image/webp"))).status).toBe(204);
  expect(decode(files.get(`main:feedback/${report.id}/screenshot-0.webp`))).toEqual(
    Buffer.from(WEBP),
  );
  expect(files.has(`main:feedback/${report.id}/screenshot-0.png`)).toBe(false);
  expect(issues[0]?.body).toContain(`/blob/main/feedback/${report.id}/screenshot-0.webp?raw=true`);
});

it("a long first line is cut to a title GitHub accepts", async () => {
  const note = `${"a".repeat(300)}\nmore`;
  expect((await route.POST(post({ ...valid(), screenshots: [], note }))).status).toBe(204);
  expect(issues[0]?.title).toBe(`${"a".repeat(80)}…`);
});

it("a repo whose default branch is not main gets the image and the link on that branch", async () => {
  repo = { ...repo, default_branch: "trunk" };
  branches.add("trunk");
  const report = valid();
  expect((await route.POST(post(report, PNG))).status).toBe(204);
  expect(files.has(`trunk:feedback/${report.id}/screenshot-0.png`)).toBe(true);
  expect(files.has(`trunk:feedback/${report.id}/report.json`)).toBe(true);
  expect(issues[0]?.body).toContain(`/blob/trunk/feedback/${report.id}/screenshot-0.png?raw=true`);
});

it("an orphan branch that was never created is an error, and no issue opens", async () => {
  process.env.GITHUB_FEEDBACK_BRANCH = "visual-feedback";
  branches.delete("visual-feedback");
  await expect(route.POST(post(valid(), PNG))).rejects.toThrow(/422 for screenshot-0\.png/);
  expect(issues).toEqual([]);
});

it("a public repo is refused on every send, and nothing is created", async () => {
  repo = { ...repo, private: false };
  expect((await route.POST(post(valid(), PNG))).status).toBe(503);
  expect(files.size).toBe(0);
  expect(issues).toEqual([]);
  expect(requests).toEqual([`GET /repos/${REPO}`]);
});

it("sending the same report again opens no second issue and replaces nothing", async () => {
  const report = valid();
  await route.POST(post(report, PNG));
  expect(
    (await route.POST(post({ ...report, note: "forged" }, Uint8Array.of(...PNG, 0)))).status,
  ).toBe(204);
  expect(issues).toHaveLength(1);
  expect(decode(files.get(`main:feedback/${report.id}/screenshot-0.png`))).toEqual(
    Buffer.from(PNG),
  );
});

it("Try again after the issue failed opens it, beside the image already committed", async () => {
  const report = valid();
  failIssue = true;
  await expect(route.POST(post(report, PNG))).rejects.toThrow(/500 for the issue/);
  expect(files.has(`main:feedback/${report.id}/report.json`)).toBe(false);
  failIssue = false;
  // A different image under the same id must not replace the one already committed.
  expect((await route.POST(post(report, Uint8Array.of(...PNG, 0)))).status).toBe(204);
  expect(issues).toHaveLength(1);
  expect(decode(files.get(`main:feedback/${report.id}/screenshot-0.png`))).toEqual(
    Buffer.from(PNG),
  );
});

it("a repo GitHub cannot find is a clear error, and nothing is created", async () => {
  process.env.GITHUB_FEEDBACK_REPO = "acme/missing";
  await expect(route.POST(post(valid(), PNG))).rejects.toThrow("GitHub answered 404 for the repo.");
  expect(issues).toEqual([]);
});

it("a failed marker write is an error, as the doc says a resend then opens a second issue", async () => {
  failMarker = true;
  await expect(route.POST(post(valid(), PNG))).rejects.toThrow(/500 for report\.json/);
  expect(issues).toHaveLength(1);
});

it("the note cannot mention anyone or break out of its block", async () => {
  const note = "Ping @everyone ```\n# heading\n@acme/team";
  await route.POST(post({ ...valid(), screenshots: [], note }));
  const body = issues[0]?.body ?? "";
  // The note sits in a fence longer than any run of backticks in it, so GitHub renders it as text.
  expect(body.startsWith("````text\n")).toBe(true);
  expect(body).toContain(`\n${note}\n\`\`\`\``);
});

it("the page URL and the browser data stay inside their own blocks", async () => {
  const breakout = "x\n\n@acme/team [link](https://example.test)";
  const report: Record<string, unknown> = { ...valid(), screenshots: [] };
  await route.POST(
    post({ ...report, page: { ...(report.page as object), url: breakout }, userAgent: breakout }),
  );
  const body = issues[0]?.body ?? "";
  expect(body).toContain(`**Page:**\n\`\`\`text\n${breakout}\n\`\`\``);
  expect(body).toContain(`**Browser:**\n\`\`\`text\n${breakout}\n`);
});

it("a long or odd report still opens an issue GitHub accepts", async () => {
  const category = "c".repeat(80);
  const note = `   \n${"`".repeat(30_000)}${"😀".repeat(40_000)}`;
  expect((await route.POST(post({ ...valid(), screenshots: [], note, category }))).status).toBe(
    204,
  );
  const [issue] = issues as [Issue];
  expect(issue.title).toBe("Feedback");
  expect(Array.from(issue.labels[1] ?? "").length).toBeLessThanOrEqual(50);
  expect(issue.body.length).toBeLessThanOrEqual(65_536);
  expect(issue.body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
});

it("a branch name with # is encoded in the image link", async () => {
  repo = { ...repo, default_branch: "fb#1" };
  branches.add("fb#1");
  const report = valid();
  await route.POST(post(report, PNG));
  expect(issues[0]?.body).toContain(`/blob/fb%231/feedback/${report.id}/screenshot-0.png?raw=true`);
});

it("Try again after the issue failed works with an image over 1 MB", async () => {
  const big = new Uint8Array(1_500_000);
  big.set(PNG);
  const report = valid();
  failIssue = true;
  await expect(route.POST(post(report, big))).rejects.toThrow(/500 for the issue/);
  failIssue = false;
  expect((await route.POST(post(report, big))).status).toBe(204);
  expect(issues).toHaveLength(1);
  expect((await route.POST(post(report, big))).status).toBe(204);
  expect(issues).toHaveLength(1);
});

it("a commit GitHub refuses as concurrent is tried again, up to two more times", async () => {
  conflicts = 2;
  expect((await route.POST(post(valid(), PNG))).status).toBe(204);
  expect(issues).toHaveLength(1);
  conflicts = 3;
  await expect(route.POST(post({ ...valid(), id: crypto.randomUUID() }, PNG))).rejects.toThrow(
    /409 for screenshot-0\.png/,
  );
});

it("a category of only space adds no label, and line breaks become spaces", async () => {
  await route.POST(post({ ...valid(), screenshots: [], category: " \n\t " }));
  expect(issues[0]?.labels).toEqual(["feedback"]);
  await route.POST(
    post({ ...valid(), screenshots: [], id: crypto.randomUUID(), category: "ui\nbug" }),
  );
  expect(issues[1]?.labels).toEqual(["feedback", "ui bug"]);
});

it("a branch name with brackets keeps the image link whole", async () => {
  repo = { ...repo, default_branch: "fb(1)" };
  branches.add("fb(1)");
  const report = valid();
  await route.POST(post(report, PNG));
  expect(issues[0]?.body).toContain(
    `![Screenshot 1](<https://github.com/${REPO}/blob/fb(1)/feedback/${report.id}/screenshot-0.png?raw=true>)`,
  );
});

it("each screenshot is committed, numbered in order, and shown in the issue in order", async () => {
  const report = valid();
  const [shot] = report.screenshots as Record<string, unknown>[];
  const form = new FormData();
  form.append("report", JSON.stringify({ ...report, screenshots: [shot, shot] }));
  form.append("image0", new Blob([PNG], { type: "image/png" }), "x");
  form.append("image1", new Blob([WEBP], { type: "image/webp" }), "x");
  const request = new Request("http://localhost/api/feedback", { method: "POST", body: form });
  expect((await route.POST(request)).status).toBe(204);
  expect(decode(files.get(`main:feedback/${report.id}/screenshot-1.webp`))).toEqual(
    Buffer.from(WEBP),
  );
  const body = issues[0]?.body ?? "";
  // Both on the report's own page: no page line of their own.
  expect(body.match(/example\.test\/bills/g)).toHaveLength(1);
  const first = body.indexOf(
    `![Screenshot 1](<https://github.com/${REPO}/blob/main/feedback/${report.id}/screenshot-0.png?raw=true>)`,
  );
  const second = body.indexOf(
    `![Screenshot 2](<https://github.com/${REPO}/blob/main/feedback/${report.id}/screenshot-1.webp?raw=true>)`,
  );
  expect(first).toBeGreaterThan(-1);
  expect(second).toBeGreaterThan(first);
});

it("a screenshot of another page than the report's names that page under its image", async () => {
  const report = valid();
  const [shot] = report.screenshots as Record<string, unknown>[];
  const other = { ...shot, page: { url: "https://example.test/settings", title: "Settings" } };
  const form = new FormData();
  form.append("report", JSON.stringify({ ...report, screenshots: [shot, other] }));
  form.append("image0", new Blob([PNG], { type: "image/png" }), "x");
  form.append("image1", new Blob([PNG], { type: "image/png" }), "x");
  const request = new Request("http://localhost/api/feedback", { method: "POST", body: form });
  expect((await route.POST(request)).status).toBe(204);
  const body = issues[0]?.body ?? "";
  const second = body.indexOf("![Screenshot 2]");
  expect(second).toBeGreaterThan(-1);
  expect(body.indexOf("https://example.test/settings")).toBeGreaterThan(second);
  expect(body.indexOf("```text\nhttps://example.test/settings\n```")).toBeGreaterThan(-1);
});

it("a report with no screenshots commits no image and says so", async () => {
  const report: Record<string, unknown> = { ...valid(), screenshots: [] };
  await route.POST(post(report));
  expect([...files.keys()]).toEqual([`main:feedback/${report.id}/report.json`]);
  expect(issues[0]?.body).toContain("No screenshot.");
  expect(issues[0]?.labels).toEqual(["feedback"]);
});

it("a request the parser refuses gets its status, and GitHub is not asked", async () => {
  expect((await route.POST(post(valid(), new TextEncoder().encode("<svg/>")))).status).toBe(400);
  expect(requests).toEqual([]);
});

it("missing or malformed settings are a clear error, and GitHub is not asked", async () => {
  for (const [name, value] of [
    ["GITHUB_FEEDBACK_REPO", undefined],
    ["GITHUB_FEEDBACK_REPO", "not a repo"],
    ["GITHUB_FEEDBACK_TOKEN", undefined],
  ] as const) {
    const before = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    await expect(route.POST(post(valid(), PNG)), `${name}=${value}`).rejects.toThrow(
      "Set GITHUB_FEEDBACK_REPO (owner/name) and GITHUB_FEEDBACK_TOKEN.",
    );
    process.env[name] = before;
  }
  expect(requests).toEqual([]);
});

it("the token goes only in the authorization header, never into an issue or a file", async () => {
  await route.POST(post(valid(), PNG));
  const everything = [
    ...issues.map((issue) => JSON.stringify(issue)),
    ...[...files.values()].map((f) => String(decode(f))),
  ];
  expect(everything.join("\n")).not.toContain(TOKEN);
});

it("the recipe tells the widget to send PNG and shows how to make the orphan branch", () => {
  expect(doc).toContain('capture: { type: "image/png" }');
  for (const step of [
    "git switch --orphan visual-feedback",
    'git commit --allow-empty -m "visual-feedback images"',
    "git push origin visual-feedback",
  ]) {
    expect(block("sh")).toContain(step);
  }
  expect(block("ts")).toMatch(/^\/\/ app\/api\/feedback\/route\.ts$/m);
});
