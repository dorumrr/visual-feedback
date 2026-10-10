import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { PNG, valid, WEBP } from "../server/sample";
import { recipe, SERVER } from "./doc";

const { doc, block, load, cleanup } = recipe("vercel-blob.md");

type Route = {
  POST(request: Request): Promise<Response>;
  GET(request: Request): Promise<Response>;
};

const TOKEN = "vercel_blob_rw_teststore_secretnotreal";
const STORE = "https://teststore.private.blob.vercel-storage.com/";
const API = "https://vercel.com/api/blob/";

// A fake of both Vercel hosts, in place of fetch: it refuses anything not shaped like the
// requests @vercel/blob 2 makes, keeps blobs by pathname, and can fail a chosen pathname.
const blobs = new Map<string, { body: Buffer; type: string }>();
const requests: string[] = [];
let failPath = "";
let failRead = "";
const realFetch = globalThis.fetch;

async function fake(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  const headers = new Headers(init.headers);
  const method = init.method ?? "GET";
  requests.push(`${method} ${url.origin}${url.pathname}${url.search}`);
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (headers.get("authorization") !== `Bearer ${token}`)
    return new Response(null, { status: 403 });
  const store = String(token).split("_")[3];
  if (url.origin === `https://${store}.private.blob.vercel-storage.com` && method === "GET") {
    // A cached read could hide a report, so every read must skip the cache.
    if (init.cache !== "no-store") return new Response(null, { status: 400 });
    if (url.pathname.slice(1) === failRead) return new Response(null, { status: 500 });
    const blob = blobs.get(url.pathname.slice(1));
    if (!blob) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(blob.body), { headers: { "content-type": blob.type } });
  }
  if (`${url.origin}${url.pathname}` === API && method === "PUT") {
    const pathname = url.searchParams.get("pathname") ?? "";
    const shaped =
      headers.get("x-api-version") === "12" &&
      headers.get("x-vercel-blob-access") === "private" &&
      headers.get("x-add-random-suffix") === "0" &&
      headers.get("x-allow-overwrite") !== null &&
      headers.get("x-content-type") !== null;
    if (!shaped)
      return new Response(JSON.stringify({ error: { code: "bad_request" } }), { status: 400 });
    if (pathname === failPath) return new Response(null, { status: 500 });
    // Vercel refuses to replace a blob unless the request allows it.
    if (blobs.has(pathname) && headers.get("x-allow-overwrite") !== "1") {
      return Response.json({ error: { code: "bad_request" } }, { status: 400 });
    }
    const body = Buffer.from(await new Response(init.body).arrayBuffer());
    blobs.set(pathname, { body, type: String(headers.get("x-content-type")) });
    return Response.json({ url: `${STORE}${pathname}`, pathname });
  }
  throw new Error(`no fake for ${method} ${url}`);
}

let route: Route;
let admin: Route;
const saved = process.env.BLOB_READ_WRITE_TOKEN;

beforeAll(async () => {
  const source = block("ts");
  route = await load<Route>(source, { "visual-feedback/server": SERVER });
  // The host's own check, filled in as the doc asks; the test admin is a request header.
  const check = "  return false;\n}";
  expect(source.split(check)).toHaveLength(2);
  const filled = source.replace(
    check,
    '  return _request.headers.get("x-test-admin") === "yes";\n}',
  );
  admin = await load<Route>(filled, { "visual-feedback/server": SERVER });
  globalThis.fetch = fake as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  cleanup();
});

beforeEach(() => {
  blobs.clear();
  requests.length = 0;
  failPath = "";
  failRead = "";
  process.env.BLOB_READ_WRITE_TOKEN = TOKEN;
});

afterEach(() => {
  if (saved === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = saved;
});

function post(report: Record<string, unknown>, image?: Uint8Array, type = "image/png"): Request {
  const form = new FormData();
  form.append("report", JSON.stringify(report));
  if (image) form.append("image", new Blob([image as Uint8Array<ArrayBuffer>], { type }), "x");
  return new Request("http://localhost/api/feedback", { method: "POST", body: form });
}

const get = (id: string, file: string, asAdmin = true) =>
  new Request(`http://localhost/api/feedback?id=${encodeURIComponent(id)}&file=${file}`, {
    headers: asAdmin ? { "x-test-admin": "yes" } : {},
  });

const at = (id: unknown, file: string) => `feedback/${String(id)}/${file}`;

it("a report sent through the recipe is stored as private blobs, image first", async () => {
  const report = valid();
  expect((await route.POST(post(report, PNG))).status).toBe(204);
  expect(requests).toEqual([
    `GET ${STORE}${at(report.id, "report.json")}`,
    `PUT ${API}?pathname=${encodeURIComponent(at(report.id, "image.png"))}`,
    `PUT ${API}?pathname=${encodeURIComponent(at(report.id, "report.json"))}`,
  ]);
  expect(blobs.get(at(report.id, "image.png"))).toEqual({
    body: Buffer.from(PNG),
    type: "image/png",
  });
  const json = blobs.get(at(report.id, "report.json"));
  expect(json?.type).toBe("application/json");
  expect(JSON.parse(String(json?.body))).toEqual({ ...report, image: "image.png" });
});

it("the host's checked route reads the report and the image back", async () => {
  const report = valid();
  await route.POST(post(report, PNG));
  const json = await admin.GET(get(String(report.id), "report.json"));
  expect(json.headers.get("cache-control")).toBe("private, no-store");
  expect(await json.json()).toEqual({ ...report, image: "image.png" });
  const image = await admin.GET(get(String(report.id), "image.png"));
  expect(image.headers.get("content-type")).toBe("image/png");
  expect(image.headers.get("cache-control")).toBe("private, no-store");
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);
});

it("a WebP report is stored and read back as image.webp", async () => {
  const report = valid();
  await route.POST(post(report, WEBP, "image/webp"));
  const image = await admin.GET(get(String(report.id), "image.webp"));
  expect(image.headers.get("content-type")).toBe("image/webp");
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(WEBP);
});

it("until the host fills in its own check, nobody can read, and Vercel is not asked", async () => {
  const report = valid();
  await route.POST(post(report, PNG));
  requests.length = 0;
  expect((await route.GET(get(String(report.id), "report.json"))).status).toBe(403);
  expect((await admin.GET(get(String(report.id), "report.json", false))).status).toBe(403);
  expect(requests).toEqual([]);
});

it("a read for any other path is refused before Vercel is asked", async () => {
  const id = "0b6c3a52-7f1e-4c2a-9d3b-5e8f0a1b2c3d";
  for (const [badId, file] of [
    ["../other", "report.json"],
    [id, "../../x"],
    [id, "image.jpg"],
    ["", "report.json"],
  ] as const) {
    expect((await admin.GET(get(badId, file))).status, `${badId} ${file}`).toBe(400);
  }
  expect(requests).toEqual([]);
  // The control: a well-formed read reaches Vercel.
  expect((await admin.GET(get(id, "report.json"))).status).toBe(404);
  expect(requests).toHaveLength(1);
});

it("a request that reuses an id cannot replace a stored report or its image", async () => {
  const report = valid();
  await route.POST(post(report, PNG));
  expect(
    (await route.POST(post({ ...report, note: "forged" }, Uint8Array.of(...PNG, 0)))).status,
  ).toBe(204);
  expect(blobs.get(at(report.id, "image.png"))?.body).toEqual(Buffer.from(PNG));
  expect(JSON.parse(String(blobs.get(at(report.id, "report.json"))?.body)).note).toBe(report.note);
});

it("Try again after a failed report write stores it, beside the image already there", async () => {
  const report = valid();
  failPath = at(report.id, "report.json");
  await expect(route.POST(post(report, PNG))).rejects.toThrow(/500 for report\.json/);
  failPath = "";
  expect((await route.POST(post(report, PNG))).status).toBe(204);
  expect(JSON.parse(String(blobs.get(at(report.id, "report.json"))?.body)).id).toBe(report.id);
});

it("when the image write fails, no report.json is written without it", async () => {
  const report = valid();
  failPath = at(report.id, "image.png");
  await expect(route.POST(post(report, PNG))).rejects.toThrow(/500 for image\.png/);
  expect(blobs.has(at(report.id, "report.json"))).toBe(false);
});

it("a report with no image stores report.json alone, with image: null", async () => {
  const report: Record<string, unknown> = { ...valid(), marks: [] };
  await route.POST(post(report));
  expect([...blobs.keys()]).toEqual([at(report.id, "report.json")]);
  expect(JSON.parse(String(blobs.get(at(report.id, "report.json"))?.body)).image).toBeNull();
});

it("a request the parser refuses gets its status, and Vercel is not asked", async () => {
  expect((await route.POST(post(valid(), new TextEncoder().encode("<svg/>")))).status).toBe(400);
  expect(requests).toEqual([]);
});

it("a missing or malformed token is a clear error, and Vercel is not asked", async () => {
  for (const token of [undefined, "not-a-blob-token", "vercel_blob_ro_teststore_secret"]) {
    if (token === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = token;
    await expect(route.POST(post(valid(), PNG)), String(token)).rejects.toThrow(
      "Set BLOB_READ_WRITE_TOKEN.",
    );
  }
  expect(requests).toEqual([]);
});

it("the recipe's endpoint and pointer match what it says", () => {
  expect(doc).toContain('createFeedback({ endpoint: "/api/feedback" })');
  expect(block("ts")).toMatch(/^\/\/ app\/api\/feedback\/route\.ts$/m);
  expect(doc).toContain("docs/recipes/s3.md");
});

it("an image over 3 MB is refused by the route itself, under Vercel's 4.5 MB body limit", async () => {
  const big = new Uint8Array(3_000_001);
  big.set(PNG);
  expect((await route.POST(post(valid(), big))).status).toBe(413);
  expect(requests).toEqual([]);
  const fits = new Uint8Array(3_000_000);
  fits.set(PNG);
  expect((await route.POST(post(valid(), fits))).status).toBe(204);
});

it("when the stored check fails, nothing is written, since the report may already exist", async () => {
  const report = valid();
  await route.POST(post(report, PNG));
  failRead = at(report.id, "report.json");
  requests.length = 0;
  await expect(route.POST(post({ ...report, note: "forged" }, PNG))).rejects.toThrow(
    /500 for report\.json/,
  );
  expect(requests.filter((request) => request.startsWith("PUT"))).toEqual([]);
  expect(JSON.parse(String(blobs.get(at(report.id, "report.json"))?.body)).note).toBe(report.note);
});

it("the read host comes from the store id in the token, not a fixed store", async () => {
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_otherstore_secretnotreal";
  const report = valid();
  expect((await route.POST(post(report, PNG))).status).toBe(204);
  expect(requests[0]).toBe(
    `GET https://otherstore.private.blob.vercel-storage.com/${at(report.id, "report.json")}`,
  );
});
