import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { PNG, valid, WEBP } from "../server/sample";
import { recipe, SERVER } from "./doc";

const { doc, block, load, cleanup } = recipe("supabase.md");

type Route = { POST(request: Request): Promise<Response> };

const KEY = "test-service-role-key-not-real";
const USER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";

// What Supabase sets up in every project, so the recipe's SQL runs as it would there: the roles,
// auth.users and auth.jwt(), the storage tables, and table access that row-level security narrows.
const SUPABASE = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false);
create table storage.objects (
  bucket_id text references storage.buckets (id),
  name text not null,
  primary key (bucket_id, name)
);
alter table storage.objects enable row level security;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated;
grant all on storage.objects to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;

let db: PGlite;
let server: Server;
let url = "";
let route: Route;
let signedIn: Route;
const objects = new Map<string, { body: Buffer; type: string }>();
const requests: string[] = [];
let failing: "storage" | "storage-404" | "rest" | "" = "";
const saved = { ...process.env };

async function body(req: import("node:http").IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

// A fake Supabase: Storage uploads and PostgREST inserts, each written into PGlite as the service
// role would, so the row-level security tests read what the route wrote.
async function handle(req: import("node:http").IncomingMessage) {
  const path = new URL(req.url ?? "", "http://x").pathname;
  requests.push(`${req.method} ${path}`);
  if (req.headers.authorization !== `Bearer ${KEY}` || req.headers.apikey !== KEY) {
    return { status: 401, json: { message: "Invalid key" } };
  }
  const raw = await body(req);
  if (failing === "storage-404" && path.startsWith("/storage/")) {
    // How Storage reports a bucket that is missing: 400, with the real code in the body.
    return { status: 400, json: { statusCode: "404", error: "Bucket not found", message: "" } };
  }
  if (failing && path.startsWith(failing === "storage" ? "/storage/" : "/rest/")) {
    return { status: 500, json: { message: "down" } };
  }
  const upload = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(path);
  if (req.method === "POST" && upload) {
    const [, bucket = "", name = ""] = upload;
    let data = raw;
    let type = String(req.headers["content-type"]);
    if (type.startsWith("multipart/form-data")) {
      const form = await new Response(new Uint8Array(raw), {
        headers: { "content-type": type },
      }).formData();
      const file = [...form.values()].find((value) => value instanceof Blob) as Blob;
      data = Buffer.from(await file.arrayBuffer());
      type = file.type;
    }
    const exists = objects.has(`${bucket}/${name}`);
    // Real Storage answers a duplicate with 400 and statusCode "409" in the body.
    if (exists && req.headers["x-upsert"] !== "true") {
      return {
        status: 400,
        json: { statusCode: "409", error: "Duplicate", message: "The resource already exists" },
      };
    }
    await asServiceRole(
      "insert into storage.objects (bucket_id, name) values ($1, $2) on conflict do nothing",
      [bucket, name],
    );
    objects.set(`${bucket}/${name}`, { body: data, type });
    return { status: 200, json: { Key: `${bucket}/${name}` } };
  }
  if (req.method === "POST" && path === "/rest/v1/feedback_reports") {
    const rows = [JSON.parse(String(raw))].flat() as Record<string, unknown>[];
    const conflict = new URL(req.url ?? "", "http://x").searchParams.get("on_conflict");
    const ignore = String(req.headers.prefer).includes("resolution=ignore-duplicates");
    for (const row of rows) {
      // Every key the client sent is a column, as PostgREST requires; an unknown one fails.
      const columns = Object.keys(row);
      if (!columns.every((name) => /^[a-z_]+$/.test(name))) return { status: 400, json: {} };
      const values = columns.map((_, i) => `$${i + 1}`).join(", ");
      const onConflict = ignore && conflict ? `on conflict (${conflict}) do nothing` : "";
      try {
        await asServiceRole(
          `insert into feedback_reports (${columns.join(", ")}) values (${values}) ${onConflict}`,
          columns.map((name) => row[name]),
        );
      } catch (error) {
        return { status: 400, json: { code: "PGRST204", message: String(error) } };
      }
    }
    return { status: 201, json: null };
  }
  return { status: 404, json: { message: `no fake for ${req.method} ${path}` } };
}

// The fake writes as Supabase's service role, which bypasses row-level security by its grants.
async function asServiceRole(sql: string, params: unknown[]) {
  await db.transaction(async (tx) => {
    await tx.exec("set local role service_role");
    await tx.query(sql, params);
  });
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE);
  await db.exec(block("sql"));
  await db.query("insert into auth.users (id) values ($1), ($2)", [USER, ADMIN]);
  server = createServer((req, res) => {
    handle(req).then(
      ({ status, json }) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(json === null ? "" : JSON.stringify(json));
      },
      (error) => res.writeHead(500).end(String(error)),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const source = block("ts");
  const imports = {
    "visual-feedback/server": SERVER,
    "@supabase/supabase-js": import.meta.resolve("@supabase/supabase-js"),
  };
  route = await load<Route>(source, imports);
  // The host's session, filled in as the doc asks; the test user is a request header.
  const stub = "  return null;\n}";
  expect(source.split(stub)).toHaveLength(2);
  const filled = source.replace(stub, '  return _request.headers.get("x-test-user");\n}');
  signedIn = await load<Route>(filled, imports);
});

afterAll(async () => {
  cleanup();
  await new Promise((done) => server.close(done));
  await db.close();
});

beforeEach(async () => {
  objects.clear();
  requests.length = 0;
  failing = "";
  await db.exec("delete from feedback_reports; delete from storage.objects;");
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
});

afterEach(() => {
  for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (name in saved) process.env[name] = saved[name];
    else delete process.env[name];
  }
});

function post(
  report: Record<string, unknown>,
  user?: string,
  image?: Uint8Array,
  type = "image/png",
) {
  const form = new FormData();
  form.append("report", JSON.stringify(report));
  if (image) form.append("image", new Blob([image as Uint8Array<ArrayBuffer>], { type }), "x");
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    body: form,
    headers: user ? { "x-test-user": user } : {},
  });
}

/** Reads as a Supabase role, with the claims Supabase would put in the JWT. */
async function readAs(role: "anon" | "authenticated", claims: object, table: string) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    return (await tx.query(`select * from ${table}`)).rows;
  });
}

const adminClaims = { sub: ADMIN, role: "authenticated", app_metadata: { role: "admin" } };
const userClaims = { sub: USER, role: "authenticated", app_metadata: {} };
// user_metadata is the user's own to edit, so it must never make anyone an admin.
const selfMadeAdmin = {
  sub: USER,
  role: "authenticated",
  app_metadata: {},
  user_metadata: { role: "admin" },
};

it("a report sent through the recipe is a row and an image, read back by an admin", async () => {
  const report = valid();
  expect((await signedIn.POST(post(report, USER, PNG))).status).toBe(204);
  expect(requests).toEqual([
    `POST /storage/v1/object/feedback/${report.id}/image.png`,
    "POST /rest/v1/feedback_reports",
  ]);
  const [row] = (await readAs("authenticated", adminClaims, "feedback_reports")) as {
    user_id: string;
    report: Record<string, unknown>;
    image_type: string;
  }[];
  const { image: _, ...stored } = { ...report, image: null };
  expect(row?.user_id).toBe(USER);
  expect(row?.report).toEqual(stored);
  expect(row?.image_type).toBe("image/png");
  expect(await readAs("authenticated", adminClaims, "storage.objects")).toEqual([
    { bucket_id: "feedback", name: `${report.id}/image.png` },
  ]);
  expect(objects.get(`feedback/${report.id}/image.png`)).toEqual({
    body: Buffer.from(PNG),
    type: "image/png",
  });
});

it("an anonymous read, or a signed-in user who is not an admin, sees no row and no image", async () => {
  await signedIn.POST(post(valid(), USER, PNG));
  // The control: the row and the object are there.
  expect((await db.query("select 1 from feedback_reports")).rows).toHaveLength(1);
  expect((await db.query("select 1 from storage.objects")).rows).toHaveLength(1);
  for (const [role, claims] of [
    ["anon", {}],
    ["authenticated", userClaims],
    ["authenticated", selfMadeAdmin],
  ] as const) {
    expect(await readAs(role, claims, "feedback_reports"), role).toEqual([]);
    expect(await readAs(role, claims, "storage.objects"), role).toEqual([]);
  }
});

it("nobody but the server can write: an insert from the browser's roles is refused", async () => {
  for (const [role, claims] of [
    ["anon", {}],
    ["authenticated", adminClaims],
  ] as const) {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec(`set local role ${role}`);
        await tx.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify(claims),
        ]);
        await tx.query(
          "insert into feedback_reports (id, user_id, created_at, report) values ($1, $2, now(), '{}')",
          [crypto.randomUUID(), USER],
        );
      }),
      role,
    ).rejects.toThrow(/row-level security/);
  }
});

it("the bucket the SQL creates is private", async () => {
  expect((await db.query("select public from storage.buckets where id = 'feedback'")).rows).toEqual(
    [{ public: false }],
  );
});

it("until the host fills in its own session check, nobody can send, and Supabase is not asked", async () => {
  expect((await route.POST(post(valid(), USER, PNG))).status).toBe(401);
  expect((await signedIn.POST(post(valid(), undefined, PNG))).status).toBe(401);
  expect(requests).toEqual([]);
});

it("sending the same report again leaves the row it already wrote", async () => {
  const report = valid();
  await signedIn.POST(post(report, USER, PNG));
  expect((await signedIn.POST(post({ ...report, note: "changed" }, USER, PNG))).status).toBe(204);
  const rows = (await db.query<{ report: { note: string } }>("select report from feedback_reports"))
    .rows;
  expect(rows.map((row) => row.report.note)).toEqual([report.note]);
});

it("a report with no image uploads nothing and stores no type", async () => {
  await signedIn.POST(post({ ...valid(), marks: [] }, USER));
  expect(requests).toEqual(["POST /rest/v1/feedback_reports"]);
  expect((await db.query("select image_type from feedback_reports")).rows).toEqual([
    { image_type: null },
  ]);
});

it("a WebP image is stored as image.webp with its type", async () => {
  const report = valid();
  await signedIn.POST(post(report, USER, WEBP, "image/webp"));
  expect(objects.get(`feedback/${report.id}/image.webp`)).toEqual({
    body: Buffer.from(WEBP),
    type: "image/webp",
  });
  expect((await db.query("select image_type from feedback_reports")).rows).toEqual([
    { image_type: "image/webp" },
  ]);
});

it("a wrong key is refused by Supabase, and the route does not report success", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "a-wrong-key";
  await expect(signedIn.POST(post(valid(), USER, PNG))).rejects.toBeDefined();
  expect((await db.query("select 1 from feedback_reports")).rows).toEqual([]);
});

it("missing settings are a clear error, and Supabase is not asked", async () => {
  for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const value = process.env[name];
    delete process.env[name];
    await expect(signedIn.POST(post(valid(), USER, PNG)), name).rejects.toThrow(
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
    process.env[name] = value;
  }
  expect(requests).toEqual([]);
});

it("the recipe's endpoint, install line and pointer match what it says", () => {
  expect(doc).toContain('createFeedback({ endpoint: "/api/feedback" })');
  expect(block("ts")).toMatch(/^\/\/ app\/api\/feedback\/route\.ts$/m);
  expect(block("sh")).toBe("npm install @supabase/supabase-js\n");
  expect(doc).toContain("docs/recipes/postgres.md");
});

it("when Storage refuses the image, no row is written without it", async () => {
  failing = "storage";
  const report = valid();
  await expect(signedIn.POST(post(report, USER, PNG))).rejects.toThrow();
  expect(requests).toEqual([`POST /storage/v1/object/feedback/${report.id}/image.png`]);
  expect((await db.query("select 1 from feedback_reports")).rows).toEqual([]);
});

it("when the insert is refused, the route does not report success", async () => {
  failing = "rest";
  const report = valid();
  await expect(signedIn.POST(post(report, USER, PNG))).rejects.toThrow();
  // It got as far as the insert, and nothing was stored.
  expect(requests.at(-1)).toBe("POST /rest/v1/feedback_reports");
  expect((await db.query("select 1 from feedback_reports")).rows).toEqual([]);
});

it("deleting a user deletes their reports, so feedback never blocks an account deletion", async () => {
  const someone = "33333333-3333-4333-8333-333333333333";
  await db.query("insert into auth.users (id) values ($1)", [someone]);
  await signedIn.POST(post(valid(), someone, PNG));
  expect((await db.query("select 1 from feedback_reports")).rows).toHaveLength(1);
  await db.query("delete from auth.users where id = $1", [someone]);
  expect((await db.query("select 1 from feedback_reports")).rows).toEqual([]);
});

it("a request that reuses an existing id cannot replace that report's image", async () => {
  const report = valid();
  await signedIn.POST(post(report, USER, PNG));
  // Same id, another PNG at the same key, as a forged request could send.
  const other = Uint8Array.of(...PNG, 0);
  expect((await signedIn.POST(post(report, ADMIN, other))).status).toBe(204);
  expect(objects.get(`feedback/${report.id}/image.png`)?.body).toEqual(Buffer.from(PNG));
  const rows = (await db.query<{ user_id: string }>("select user_id from feedback_reports")).rows;
  expect(rows).toEqual([{ user_id: USER }]);
});

it("a Storage error that is not a duplicate, such as a missing bucket, fails the send", async () => {
  failing = "storage-404";
  await expect(signedIn.POST(post(valid(), USER, PNG))).rejects.toThrow();
  expect((await db.query("select 1 from feedback_reports")).rows).toEqual([]);
});

it("Try again after a failed insert stores the row, beside the image already there", async () => {
  const report = valid();
  failing = "rest";
  await expect(signedIn.POST(post(report, USER, PNG))).rejects.toThrow();
  failing = "";
  expect((await signedIn.POST(post(report, USER, PNG))).status).toBe(204);
  expect((await db.query("select id from feedback_reports")).rows).toEqual([{ id: report.id }]);
  expect([...objects.keys()]).toEqual([`feedback/${report.id}/image.png`]);
});

it("an admin reads only the feedback bucket, not the app's other files", async () => {
  await db.exec(
    "insert into storage.buckets (id, name) values ('other', 'other') on conflict do nothing",
  );
  await db.query("insert into storage.objects (bucket_id, name) values ('other', 'private.pdf')");
  await signedIn.POST(post(valid(), USER, PNG));
  const seen = (await readAs("authenticated", adminClaims, "storage.objects")) as {
    bucket_id: string;
  }[];
  expect(seen.map((row) => row.bucket_id)).toEqual(["feedback"]);
  await db.exec("delete from storage.objects where bucket_id = 'other'");
});

it("the browser's roles cannot change or delete a stored report or image", async () => {
  const report = valid();
  await signedIn.POST(post(report, USER, PNG));
  for (const [role, claims] of [
    ["anon", {}],
    ["authenticated", adminClaims],
  ] as const) {
    await db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await tx.query("update feedback_reports set image_type = 'x'");
      await tx.query("delete from feedback_reports");
      await tx.query("update storage.objects set name = 'moved'");
      await tx.query("delete from storage.objects");
    });
    await expect(
      db.transaction(async (tx) => {
        await tx.exec(`set local role ${role}`);
        await tx.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify(claims),
        ]);
        await tx.query(
          "insert into storage.objects (bucket_id, name) values ('feedback', 'x.png')",
        );
      }),
      role,
    ).rejects.toThrow(/row-level security/);
  }
  expect((await db.query("select image_type from feedback_reports")).rows).toEqual([
    { image_type: "image/png" },
  ]);
  expect((await db.query("select name from storage.objects")).rows).toEqual([
    { name: `${report.id}/image.png` },
  ]);
});
