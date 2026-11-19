import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { ATTACHMENT_TYPES } from "../../src/shared/report";
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
let withFiles: Route;
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
  // The host turns files on as step 3 says: the one constant, flipped.
  const off = "const ATTACHMENTS = false;";
  expect(filled.split(off)).toHaveLength(2);
  withFiles = await load<Route>(filled.replace(off, "const ATTACHMENTS = true;"), imports);
});

afterAll(() => {
  cleanup();
  if (saved === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved;
});

beforeEach(() => {
  store.reports = [];
  store.shots = [];
  store.files = [];
  store.refuseShots = false;
  store.refuseFiles = false;
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

const LOG = new TextEncoder().encode("line one\nline two\n");
// Other bytes than the screenshot's, so a route that stores the image as a file is caught.
const ATTACHED_PNG = Uint8Array.of(...PNG, 0);

// A report with a PNG and a log attached, as the widget sends them.
function postFiles(
  report: Record<string, unknown>,
  files = [
    { name: "Shot.PNG", type: "image/png", bytes: ATTACHED_PNG },
    { name: "server.log", type: "text/plain", bytes: LOG },
  ],
) {
  const user = "user-7";
  const form = new FormData();
  const attachments = files.map(({ name, type, bytes }) => ({ name, type, size: bytes.length }));
  form.append("report", JSON.stringify({ ...report, attachments }));
  form.append("image0", new Blob([PNG], { type: "image/png" }), "x");
  for (const [i, { name, type, bytes }] of files.entries()) {
    form.append(`file${i}`, new Blob([bytes as Uint8Array<ArrayBuffer>], { type }), name);
  }
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    body: form,
    headers: { "x-test-user": user },
  });
}

async function files() {
  return [...store.files].sort(
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

it("files are off as the recipe ships: a report with files gets 400, and nothing is written", async () => {
  expect(block("ts")).toContain("const ATTACHMENTS = false;");
  expect(block("ts")).toContain("parseFeedbackRequest(request, { attachments: ATTACHMENTS })");
  expect((await signedIn.POST(postFiles(valid()))).status).toBe(400);
  expect(await rows()).toEqual([]);
  expect(await shots()).toEqual([]);
  expect(await files()).toEqual([]);
});

it("with files on, each file is its own row with its bytes, and the report lists them without the files", async () => {
  const report = valid();
  expect((await withFiles.POST(postFiles(report))).status).toBe(204);
  const [row, ...rest] = await rows();
  expect(rest).toEqual([]);
  expect(await shots()).toHaveLength(1);
  const stored = await files();
  expect(stored.map(({ file: _, ...facts }) => facts)).toEqual([
    {
      report_id: report.id,
      position: 0,
      name: "Shot.PNG",
      type: "image/png",
      size: ATTACHED_PNG.length,
      stored_name: "file-0.png",
    },
    {
      report_id: report.id,
      position: 1,
      name: "server.log",
      type: "text/plain",
      size: LOG.length,
      stored_name: "file-1.log",
    },
  ]);
  expect(new Uint8Array(stored[0]?.file ?? [])).toEqual(ATTACHED_PNG);
  expect(new Uint8Array(stored[1]?.file ?? [])).toEqual(LOG);
  // Each stored name ends as its type allows, never as the user named it.
  for (const { stored_name, type } of stored) {
    expect(ATTACHMENT_TYPES[type]?.some((ending) => stored_name.endsWith(ending))).toBe(true);
  }
  expect(row?.report).toEqual({
    ...report,
    attachments: [
      { name: "Shot.PNG", type: "image/png", size: ATTACHED_PNG.length, file: "file-0.png" },
      { name: "server.log", type: "text/plain", size: LOG.length, file: "file-1.log" },
    ],
  });
});

it("sending the same report with files again writes nothing twice", async () => {
  const report = valid();
  expect((await withFiles.POST(postFiles(report))).status).toBe(204);
  const first = await files();
  expect(first).toHaveLength(2);
  expect((await withFiles.POST(postFiles({ ...report, note: "changed" }))).status).toBe(204);
  expect(await rows()).toHaveLength(1);
  expect((await rows())[0]?.report.note).toBe(report.note);
  expect(await shots()).toHaveLength(1);
  expect(await files()).toEqual(first);
});

it("with files on, a report with none writes the same rows as with files off", async () => {
  const report = valid();
  expect((await signedIn.POST(post(report, "user-7", PNG))).status).toBe(204);
  const today = { reports: await rows(), shots: await shots() };
  store.reports = [];
  store.shots = [];
  expect((await withFiles.POST(post(report, "user-7", PNG))).status).toBe(204);
  expect({ reports: await rows(), shots: await shots() }).toEqual(today);
  expect(today.reports[0]?.report).not.toHaveProperty("attachments");
  expect(await files()).toEqual([]);
  // An empty list, as a widget may send it, is the same as none.
  store.reports = [];
  store.shots = [];
  expect((await withFiles.POST(postFiles(report, []))).status).toBe(204);
  expect({ reports: await rows(), shots: await shots() }).toEqual(today);
  expect(await files()).toEqual([]);
});

it("with files on, a file whose bytes are not its type gets 400, and nothing is written", async () => {
  const spoofed = [{ name: "Shot.png", type: "image/png", bytes: LOG }];
  expect((await withFiles.POST(postFiles(valid(), spoofed))).status).toBe(400);
  expect(await rows()).toEqual([]);
  expect(await shots()).toEqual([]);
  expect(await files()).toEqual([]);
});

it("when a file cannot be stored, the report and its screenshots are not kept either", async () => {
  store.refuseFiles = true;
  await expect(withFiles.POST(postFiles(valid()))).rejects.toThrow(/refused/);
  expect(await rows()).toEqual([]);
  expect(await shots()).toEqual([]);
  expect(await files()).toEqual([]);
  store.refuseFiles = false;
  expect((await withFiles.POST(postFiles(valid()))).status).toBe(204);
  expect(await files()).toHaveLength(2);
});

it("the SQL block makes the files table, its last statement, which is all an older install runs", () => {
  const sql = block("sql").replace(/\s+/g, " ").trim();
  const statements = sql
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  expect(statements.at(-1)).toBe(
    "create table feedback_attachments ( report_id uuid not null references feedback_reports (id) on delete cascade, position integer not null, name text not null, type text not null, size integer not null, stored_name text not null, file bytea not null, primary key (report_id, position) )",
  );
  const text = doc.replace(/\s+/g, " ");
  expect(text).toContain(
    "A new install made the `feedback_attachments` table in step 1. An install made before files runs only that one statement from step 1,",
  );
  expect(text).toContain("together with the widget's `attachments` option");
  expect(text).toContain("keep `ATTACHMENTS` as the app set it.");
  expect(text).toContain(
    "replaces its route with step 2's, keeping what the app changed, such as its `currentUser`, the bucket PUT or `prepare: false`: an older route has no `ATTACHMENTS` and stores no files.",
  );
});

it("the fake refuses a file row with no report, a repeated position or other columns", async () => {
  type Tx = ((s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>) &
    ((rows: unknown[]) => unknown);
  const client = (await import(FAKE)).default(URL_SET);
  const row = {
    report_id: "r",
    position: 0,
    name: "a.png",
    type: "image/png",
    size: 1,
    stored_name: "file-0.png",
    file: new Uint8Array([1]),
  };
  const report = (tx: Tx) =>
    tx`insert into feedback_reports (id, user_id, created_at, report) values (${"r"}, ${"u"}, ${"2026-01-01T00:00:00.000Z"}, ${client.json({})}) on conflict (id) do nothing returning id`;
  for (const [rowsIn, error, withReport] of [
    [[row], /foreign key/, false],
    [[row, row], /duplicate key/, true],
    [[{ ...row, extra: 1 }], /columns/, true],
    [[], /at least one row/, true],
  ] as const) {
    await expect(
      client.begin(async (tx: Tx) => {
        if (withReport) await report(tx);
        await tx`insert into feedback_attachments ${tx([...rowsIn])}`;
      }),
    ).rejects.toThrow(error);
  }
  expect(store.reports).toEqual([]);
  expect(store.files).toEqual([]);
});
