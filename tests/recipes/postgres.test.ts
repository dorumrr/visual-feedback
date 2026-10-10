import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
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
type Shot = { report_id: string; position: number; image: Uint8Array | null; image_type: string };

let db: PGlite;
let server: PGLiteSocketServer;
let route: Route;
let signedIn: Route;
const saved = process.env.DATABASE_URL;

// A real Postgres engine in WASM, in this process, served on a local port as Postgres would be.
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(block("sql"));
  // Port 0: the system picks a free port, so no other process can take it first.
  server = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 10 });
  await server.start();
  process.env.DATABASE_URL = `postgres://postgres@${server.getServerConn()}/postgres`;
  const source = block("ts");
  const imports = { "visual-feedback/server": SERVER, postgres: import.meta.resolve("postgres") };
  route = await load<Route>(source, imports);
  // The host's session, filled in as the doc asks; the test user is a request header.
  const stub = "  return null;\n}";
  expect(source.split(stub)).toHaveLength(2);
  const filled = source.replace(stub, '  return _request.headers.get("x-test-user");\n}');
  signedIn = await load<Route>(filled, imports);
});

afterAll(async () => {
  cleanup();
  await server?.stop();
  await db?.close();
  if (saved === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = saved;
});

beforeEach(async () => {
  await db.exec("delete from feedback_reports");
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
  return (await db.query<Row>("select * from feedback_reports order by created_at")).rows;
}

async function shots(): Promise<Shot[]> {
  const query = "select * from feedback_screenshots order by report_id, position";
  return (await db.query<Shot>(query)).rows;
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
  await db.exec(`
    create function refuse() returns trigger language plpgsql as $$
      begin raise exception 'refused'; end $$;
    create trigger refuse before insert on feedback_screenshots
      for each row execute function refuse();`);
  try {
    await expect(signedIn.POST(post(valid(), "user-7", PNG))).rejects.toThrow(/refused/);
    expect(await rows()).toEqual([]);
  } finally {
    await db.exec("drop trigger refuse on feedback_screenshots; drop function refuse();");
  }
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
        postgres: import.meta.resolve("postgres"),
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
});

it("context text with a NUL is still stored", async () => {
  const report = { ...valid(), context: { plan: "pro\u0000" } };
  expect((await signedIn.POST(post(report, "user-7", PNG))).status).toBe(204);
  const [row] = await rows();
  expect(row?.report.context).toEqual({ plan: "pro" });
});
