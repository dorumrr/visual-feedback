import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { PNG, valid, WEBP } from "../server/sample";
import { recipe, SERVER } from "./doc";

const { doc, block, load, cleanup } = recipe("postgres.md");
const s3 = recipe("s3.md").doc;

type Route = { POST(request: Request): Promise<Response> };
type Row = {
  id: string;
  user_id: string;
  created_at: Date;
  report: Record<string, unknown>;
};

// The recipe's postgres client is the fake, loaded by the same URL here, so both share its store.
const FAKE = pathToFileURL(fileURLToPath(new URL("./fake-postgres.ts", import.meta.url))).href;
const { store } = (await import(FAKE)) as typeof import("./fake-postgres");
const URL_SET = "postgres://user@db.test/feedback";
let route: Route;
let signedIn: Route;
const saved = process.env.DATABASE_URL;

beforeAll(async () => {
  process.env.DATABASE_URL = URL_SET;
  const source = block("ts");
  const imports = { "visual-feedback/server": SERVER, postgres: FAKE };
  route = await load<Route>(source, imports);
  // The host's session, filled in as the doc asks; the test user is a request header.
  const stub = "  return null;\n}";
  expect(source.split(stub)).toHaveLength(2);
  const filled = source.replace(stub, '  return _request.headers.get("x-test-user");\n}');
  signedIn = await load<Route>(filled, imports);
});

afterAll(() => {
  cleanup();
  if (saved === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved;
});

beforeEach(() => {
  store.reports = [];
  store.shots = [];
  store.refuseShots = false;
});

function post(
  report: Record<string, unknown>,
  user?: string,
  image?: Uint8Array,
  type = "image/png",
) {
  const form = new FormData();
  form.append("report", JSON.stringify(report));
  if (image) form.append("image0", new Blob([image as Uint8Array<ArrayBuffer>], { type }), "x");
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    body: form,
    headers: user ? { "x-test-user": user } : {},
  });
}

async function rows(): Promise<Row[]> {
  return [...store.reports].sort((a, b) => +a.created_at - +b.created_at) as Row[];
}

async function shots() {
  return [...store.shots].sort(
    (a, b) => a.report_id.localeCompare(b.report_id) || a.position - b.position,
  );
}

const none = (report: Record<string, unknown>) => ({ ...report, screenshots: [] });

it("a report sent through the recipe is one row, read back with its image", async () => {
  const report = valid();
  expect((await signedIn.POST(post(report, "user-7", PNG))).status).toBe(204);
  const [row, ...rest] = await rows();
  expect(rest).toEqual([]);
  expect(row?.id).toBe(report.id);
  expect(row?.user_id).toBe("user-7");
  expect(row?.created_at.toISOString()).toBe(report.createdAt);
  // The sample's screenshots carry no image, as the stored report's do not.
  expect(row?.report).toEqual(report);
  const [shot, ...more] = await shots();
  expect(more).toEqual([]);
  expect(shot?.report_id).toBe(report.id);
  expect(shot?.position).toBe(0);
  expect(shot?.image_type).toBe("image/png");
  expect(new Uint8Array(shot?.image ?? [])).toEqual(PNG);
});

it("each screenshot is its own row, by position, beside one report row", async () => {
  const report = valid();
  const [first] = report.screenshots as Record<string, unknown>[];
  const both = { ...report, screenshots: [first, { ...first, scroll: { x: 0, y: 900 } }] };
  const form = new FormData();
  form.append("report", JSON.stringify(both));
  form.append("image0", new Blob([PNG], { type: "image/png" }), "x");
  form.append("image1", new Blob([WEBP], { type: "image/webp" }), "x");
  const request = new Request("http://localhost/api/feedback", {
    method: "POST",
    body: form,
    headers: { "x-test-user": "user-7" },
  });
  expect((await signedIn.POST(request)).status).toBe(204);
  expect(await rows()).toHaveLength(1);
  const stored = await shots();
  expect(stored.map((shot) => [shot.position, shot.image_type])).toEqual([
    [0, "image/png"],
    [1, "image/webp"],
  ]);
  expect(new Uint8Array(stored[1]?.image ?? [])).toEqual(WEBP);
  const [row] = await rows();
  expect((row?.report.screenshots as unknown[] | undefined)?.[1]).toMatchObject({
    scroll: { x: 0, y: 900 },
  });
});

it("when a screenshot cannot be stored, the report row is not kept either", async () => {
  store.refuseShots = true;
  await expect(signedIn.POST(post(valid(), "user-7", PNG))).rejects.toThrow(/refused/);
  expect(await rows()).toEqual([]);
  store.refuseShots = false;
  // The control: without the trigger, the same request stores both.
  expect((await signedIn.POST(post(valid(), "user-7", PNG))).status).toBe(204);
  expect(await rows()).toHaveLength(1);
  expect(await shots()).toHaveLength(1);
});

it("the user comes from the session, never from report.context", async () => {
  const report = { ...valid(), context: { userId: "someone-else" } };
  await signedIn.POST(post(report, "user-from-session", PNG));
  const [row] = await rows();
  expect(row?.user_id).toBe("user-from-session");
  // context is kept as sent, as data, not as identity.
  expect(row?.report.context).toEqual({ userId: "someone-else" });
});

it("until the host fills in its own session check, nobody can send, and nothing is written", async () => {
  expect((await route.POST(post(valid(), "user-7", PNG))).status).toBe(401);
  expect((await signedIn.POST(post(valid(), undefined, PNG))).status).toBe(401);
  expect(await rows()).toEqual([]);
});

it("sending the same report again leaves the row it already wrote", async () => {
  const report = valid();
  await signedIn.POST(post(report, "user-7", PNG));
  expect((await signedIn.POST(post({ ...report, note: "changed" }, "user-7", PNG))).status).toBe(
    204,
  );
  const all = await rows();
  expect(all).toHaveLength(1);
  expect(all[0]?.report.note).toBe(report.note);
  expect(await shots()).toHaveLength(1);
});

it("a report with no screenshots is one row and no screenshot rows", async () => {
  expect((await signedIn.POST(post(none(valid()), "user-7"))).status).toBe(204);
  expect(await rows()).toHaveLength(1);
  expect(await shots()).toEqual([]);
});

it("a WebP image is stored with its type", async () => {
  await signedIn.POST(post(valid(), "user-7", WEBP, "image/webp"));
  const [shot] = await shots();
  expect(shot?.image_type).toBe("image/webp");
  expect(new Uint8Array(shot?.image ?? [])).toEqual(WEBP);
});

it("a request the parser refuses gets its status, and nothing is written", async () => {
  const spoofed = new TextEncoder().encode("<svg/>");
  expect((await signedIn.POST(post(valid(), "user-7", spoofed))).status).toBe(400);
  expect(await rows()).toEqual([]);
});

it("the recipe's endpoint, install line and bucket pointer match what it says", () => {
  expect(doc).toContain('createFeedback({ endpoint: "/api/feedback" })');
  expect(block("ts")).toMatch(/^\/\/ app\/api\/feedback\/route\.ts$/m);
  expect(block("sh")).toBe("npm install postgres\n");
  expect(doc).toContain("docs/recipes/s3.md");
});

it("an unset DATABASE_URL is a clear error, and nothing is written", async () => {
  const url = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    // A fresh copy of the route, so no connection from an earlier test is reused.
    const fresh = await load<Route>(
      block("ts").replace("  return null;\n}", '  return "user-7";\n}'),
      {
        "visual-feedback/server": SERVER,
        postgres: FAKE,
      },
    );
    await expect(fresh.POST(post(valid(), undefined, PNG))).rejects.toThrow("Set DATABASE_URL.");
  } finally {
    process.env.DATABASE_URL = url;
  }
  expect(await rows()).toEqual([]);
});

it("the recipe says what the report column holds and how to keep images in a bucket", () => {
  expect(doc.replace(/\s+/g, " ")).toContain("its screenshots without their images, as `jsonb`");
  expect(doc.replace(/\s+/g, " ")).toContain(
    "keep `image_type`: `image/png` is the file `screenshot-<position>.png`, and `image/webp` is `screenshot-<position>.webp`.",
  );
  // The insert keeps the first row on a reused id, so the image PUT must keep the first image.
  expect(doc).toContain('with `"if-none-match": "*"`, so a reused id never replaces a stored');
  expect(s3).toContain('headers: { "content-type": type, "if-none-match": "*" },');
});

it("a note with a NUL or half an emoji is still stored, which jsonb alone would refuse", async () => {
  const report = { ...valid(), note: "cut \ud83d here\u0000" };
  expect((await signedIn.POST(post(report, "user-7", PNG))).status).toBe(204);
  const [row] = await rows();
  expect(row?.report.note).toBe("cut \ufffd here");
  // The fake refuses both raw as jsonb does, so the note above was cleaned before it was stored.
  const client = (await import(FAKE)).default(URL_SET);
  for (const note of ["\u0000", "cut \ud83d here"]) {
    const json = client.json({ note });
    await expect(
      client.begin(
        (tx: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>) =>
          tx`insert into feedback_reports (id, user_id, created_at, report) values (${"r"}, ${"u"}, ${"2026-01-01T00:00:00.000Z"}, ${json}) on conflict (id) do nothing returning id`,
      ),
    ).rejects.toThrow(/Unicode/);
  }
});

it("context text with a NUL is still stored", async () => {
  const report = { ...valid(), context: { plan: "pro\u0000" } };
  expect((await signedIn.POST(post(report, "user-7", PNG))).status).toBe(204);
  const [row] = await rows();
  expect(row?.report.context).toEqual({ plan: "pro" });
});

it("connects on the first send, not at import, with one client for every send after it", async () => {
  const before = store.clients.length;
  const fresh = await load<Route>(
    block("ts").replace("  return null;\n}", '  return "user-7";\n}'),
    {
      "visual-feedback/server": SERVER,
      postgres: FAKE,
    },
  );
  expect(store.clients).toHaveLength(before);
  for (let i = 0; i < 2; i++) {
    expect((await fresh.POST(post(valid(), undefined, PNG))).status).toBe(204);
  }
  // idle_timeout closes a pool a hot reload left behind.
  expect(store.clients.slice(before)).toEqual([{ url: URL_SET, options: { idle_timeout: 20 } }]);
});

it("the SQL block makes the tables and columns the route writes, a screenshot tied to its report", () => {
  const sql = block("sql").replace(/\s+/g, " ");
  for (const column of [
    "id uuid primary key",
    "user_id text not null",
    "created_at timestamptz not null",
    "report jsonb not null",
    "report_id uuid not null references feedback_reports (id) on delete cascade",
    "position integer not null",
    "image bytea",
    "image_type text not null",
    "primary key (report_id, position)",
  ]) {
    expect(sql).toContain(column);
  }
});

it("the fake keeps Postgres's rules the recipe relies on, so it cannot pass a route that breaks them", async () => {
  type Tx = (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
  const client = (await import(FAKE)).default(URL_SET);
  const insert = (tx: Tx, id: string, note: string) =>
    tx`insert into feedback_reports (id, user_id, created_at, report) values (${id}, ${"u"}, ${"2026-01-01T00:00:00.000Z"}, ${client.json({ note })}) on conflict (id) do nothing returning id`;
  // Text that only looks like an escape is stored as it is.
  await client.begin((tx: Tx) => insert(tx, "a", "\\u0000 and \\ud83d"));
  expect(store.reports.map((row) => row.id)).toEqual(["a"]);
  // A failed statement aborts the transaction, even if the route catches it: nothing is kept.
  store.refuseShots = true;
  await client.begin(async (tx: Tx & ((rows: unknown[]) => unknown)) => {
    await insert(tx, "b", "x");
    await tx`insert into feedback_screenshots ${tx([{ report_id: "b", position: 0, image: null, image_type: "image/png" }])}`.catch(
      () => {},
    );
    await expect(insert(tx, "c", "x")).rejects.toThrow(/aborted/);
  });
  store.refuseShots = false;
  expect(store.reports.map((row) => row.id)).toEqual(["a"]);
  // A route that throws inside the transaction keeps nothing either, as postgres.js rolls back.
  await expect(
    client.begin(async (tx: Tx) => {
      await insert(tx, "g", "x");
      throw new Error("the route's own error");
    }),
  ).rejects.toThrow("the route's own error");
  expect(store.reports.map((row) => row.id)).toEqual(["a"]);
  // Two transactions at once both keep their rows.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = client.begin(async (tx: Tx) => {
    await insert(tx, "d", "x");
    await held;
  });
  await client.begin((tx: Tx) => insert(tx, "e", "x"));
  release();
  await first;
  expect(store.reports.map((row) => row.id).sort()).toEqual(["a", "d", "e"]);
  // A statement after its transaction ended is refused, as postgres.js does.
  let stale: Tx | undefined;
  await client.begin(async (tx: Tx) => {
    stale = tx;
  });
  await expect(insert(stale as Tx, "f", "x")).rejects.toThrow(/ended/);
});
