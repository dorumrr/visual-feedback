import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { ATTACHMENT_TYPES, REPORT_LIMIT, SCREENSHOT_LIMIT } from "../../src/shared/report";
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
let withFiles: Route;
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
  // Files on, as the doc says to set them with the widget's attachments option.
  const off = "const ATTACHMENTS: typeof FILES | false = false;";
  expect(filled.split(off)).toHaveLength(2);
  const on = filled.replace(off, "const ATTACHMENTS: typeof FILES | false = FILES;");
  withFiles = await load<Route>(on, { "visual-feedback/server": SERVER });
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
  if (image) form.append("image0", new Blob([image as Uint8Array<ArrayBuffer>], { type }), "x");
  return new Request("http://localhost/api/feedback", { method: "POST", body: form });
}

type Report = Record<string, unknown>;
// The report as stored: each screenshot's image is its file name.
const named = (report: Report, ...files: string[]): Report => ({
  ...report,
  screenshots: (report.screenshots as Report[]).map((shot, i) => ({ ...shot, image: files[i] })),
});
// The sample report with a second screenshot, scrolled further down.
const two = (report: Report): Report => {
  const [shot] = report.screenshots as Report[];
  return { ...report, screenshots: [shot, { ...shot, scroll: { x: 0, y: 900 } }] };
};

// A report of two screenshots: a PNG, then a WebP.
function postTwo(report: Report): Request {
  const form = new FormData();
  form.append("report", JSON.stringify(two(report)));
  form.append("image0", new Blob([PNG as Uint8Array<ArrayBuffer>], { type: "image/png" }), "x");
  form.append("image1", new Blob([WEBP as Uint8Array<ArrayBuffer>], { type: "image/webp" }), "x");
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
    `PUT ${API}?pathname=${encodeURIComponent(at(report.id, "screenshot-0.png"))}`,
    `PUT ${API}?pathname=${encodeURIComponent(at(report.id, "report.json"))}`,
  ]);
  expect(blobs.get(at(report.id, "screenshot-0.png"))).toEqual({
    body: Buffer.from(PNG),
    type: "image/png",
  });
  const json = blobs.get(at(report.id, "report.json"));
  expect(json?.type).toBe("application/json");
  expect(JSON.parse(String(json?.body))).toEqual(named(report, "screenshot-0.png"));
});

it("each screenshot is its own blob, numbered in order, all before report.json", async () => {
  const report = valid();
  expect((await route.POST(postTwo(report))).status).toBe(204);
  expect(requests).toEqual([
    `GET ${STORE}${at(report.id, "report.json")}`,
    `PUT ${API}?pathname=${encodeURIComponent(at(report.id, "screenshot-0.png"))}`,
    `PUT ${API}?pathname=${encodeURIComponent(at(report.id, "screenshot-1.webp"))}`,
    `PUT ${API}?pathname=${encodeURIComponent(at(report.id, "report.json"))}`,
  ]);
  const stored = JSON.parse(String(blobs.get(at(report.id, "report.json"))?.body));
  expect(stored).toEqual(named(two(report), "screenshot-0.png", "screenshot-1.webp"));
  const second = await admin.GET(get(String(report.id), "screenshot-1.webp"));
  expect(second.headers.get("content-type")).toBe("image/webp");
  expect(new Uint8Array(await second.arrayBuffer())).toEqual(WEBP);
});

it("the host's checked route reads the report and the image back", async () => {
  const report = valid();
  await route.POST(post(report, PNG));
  const json = await admin.GET(get(String(report.id), "report.json"));
  expect(json.headers.get("cache-control")).toBe("private, no-store");
  expect(await json.json()).toEqual(named(report, "screenshot-0.png"));
  const image = await admin.GET(get(String(report.id), "screenshot-0.png"));
  expect(image.headers.get("content-type")).toBe("image/png");
  expect(image.headers.get("cache-control")).toBe("private, no-store");
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);
});

it("a WebP report is stored and read back as image.webp", async () => {
  const report = valid();
  await route.POST(post(report, WEBP, "image/webp"));
  const image = await admin.GET(get(String(report.id), "screenshot-0.webp"));
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
    [id, "image.png"],
    [id, "screenshot-10.png"],
    [id, "screenshot-0.gif"],
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
  expect(blobs.get(at(report.id, "screenshot-0.png"))?.body).toEqual(Buffer.from(PNG));
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
  failPath = at(report.id, "screenshot-0.png");
  await expect(route.POST(post(report, PNG))).rejects.toThrow(/500 for screenshot-0\.png/);
  expect(blobs.has(at(report.id, "report.json"))).toBe(false);
});

it("a report with no screenshots stores report.json alone", async () => {
  const report: Record<string, unknown> = { ...valid(), screenshots: [] };
  await route.POST(post(report));
  expect([...blobs.keys()]).toEqual([at(report.id, "report.json")]);
  expect(JSON.parse(String(blobs.get(at(report.id, "report.json"))?.body)).screenshots).toEqual([]);
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

// Vercel refuses a request body over 4.5 MB.
const VERCEL_BODY = 4_500_000;
const IMAGE_BYTES = 250_000;
const LOG = new TextEncoder().encode("TypeError: x is undefined\n");
type File = { name: string; type: string; bytes: Uint8Array };
const files: File[] = [
  { name: "Screen shot.png", type: "image/png", bytes: PNG },
  { name: "Crash Report.LOG", type: "text/plain", bytes: LOG },
];

const padded = (bytes: Uint8Array, size: number) => {
  const out = new Uint8Array(size);
  out.set(bytes);
  return out;
};

/** A report with its PNG screenshots and its files, as the widget sends them. */
function postWith(report: Report, images: Uint8Array[], list: File[], pad = 0): Request {
  const form = new FormData();
  const attachments = list.map(({ name, type, bytes }) => ({ name, type, size: bytes.length }));
  form.append("report", JSON.stringify(list.length ? { ...report, attachments } : report));
  for (const [i, bytes] of images.entries()) {
    form.append(
      `image${i}`,
      new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }),
      "x",
    );
  }
  for (const [i, { type, bytes }] of list.entries()) {
    form.append(`file${i}`, new Blob([bytes as Uint8Array<ArrayBuffer>], { type }), "x");
  }
  if (pad) form.append("pad", "p".repeat(pad));
  return new Request("http://localhost/api/feedback", { method: "POST", body: form });
}

const bodySize = async (request: Request) => (await request.clone().arrayBuffer()).byteLength;

/** The largest report the route takes with files on: 10 screenshots, 10 files, a 1 MiB report. */
function atLimits(): { report: Report; images: Uint8Array[]; list: File[] } {
  const [shot] = valid().screenshots as Report[];
  const report: Report = { ...valid(), screenshots: Array.from({ length: 10 }, () => shot) };
  const list = Array.from({ length: 10 }, (_, i) => ({
    name: `log-${i}.log`,
    type: "text/plain",
    bytes: new TextEncoder().encode("a".repeat(80_000)),
  }));
  const attachments = list.map(({ name, type, bytes }) => ({ name, type, size: bytes.length }));
  const base = new Blob([JSON.stringify({ ...report, note: "", attachments })]).size;
  const note = "n".repeat(1_048_576 - base);
  const images = Array.from({ length: 10 }, () => padded(PNG, IMAGE_BYTES));
  return { report: { ...report, note }, images, list };
}

it("the limits the test uses are the ones the doc's route sets", () => {
  const source = block("ts");
  expect(source).toContain(
    "const FILES = { maxFiles: 10, maxBytes: 800_000, maxTotalBytes: 800_000 };",
  );
  expect(source).toContain("const maxImageBytes = ATTACHMENTS ? 250_000 : 3_000_000;");
  // The server's own body cap with these limits, multipart framing included, as the doc gives it.
  const cap = SCREENSHOT_LIMIT * IMAGE_BYTES + 800_000 + REPORT_LIMIT + 65_536;
  expect(cap).toBe(4_414_112);
  expect(cap).toBeLessThan(VERCEL_BODY);
  expect(doc).toContain("make 4,414,112 bytes");
  expect(VERCEL_BODY - REPORT_LIMIT - 65_536).toBe(3_385_888);
  expect(doc).toContain("must stay at 3,385,888 bytes or less");
});

it("as shipped, attachments are off: a report with files is refused, and Vercel is not asked", async () => {
  for (const shipped of [route, admin]) {
    const response = await shipped.POST(postWith(valid(), [PNG], files));
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("This endpoint takes no attachments.");
  }
  expect(requests).toEqual([]);
});

it("with files on, a report at every limit, 10 screenshots included, is under 4.5 MB and stored", async () => {
  const { report, images, list } = atLimits();
  const request = postWith(report, images, list);
  expect(await bodySize(request)).toBeLessThan(VERCEL_BODY);
  expect((await withFiles.POST(request)).status).toBe(204);
  const stored = JSON.parse(String(blobs.get(at(report.id, "report.json"))?.body));
  expect(stored.note).toBe(report.note);
  expect(stored.attachments).toHaveLength(10);
  expect(blobs.size).toBe(21);
  expect(blobs.get(at(report.id, "file-9.log"))?.body).toHaveLength(80_000);
});

it("with files on, the route takes a body of 4,414,112 bytes and refuses one byte more, with a reason", async () => {
  const { report, images, list } = atLimits();
  // A padding part the parser ignores, sized so the whole body is exactly the given size.
  const sized = async (size: number) => {
    const overhead = (await bodySize(postWith(report, images, list, 1))) - 1;
    const request = postWith(report, images, list, size - overhead);
    expect(await bodySize(request)).toBe(size);
    return request;
  };
  for (const size of [4_414_113, VERCEL_BODY + 1]) {
    const response = await withFiles.POST(await sized(size));
    expect(response.status, String(size)).toBe(413);
    expect(await response.text()).toBe("The request is too large.");
  }
  expect(requests).toEqual([]);
  // The control: at the cap exactly, the body is taken.
  expect((await withFiles.POST(await sized(4_414_112))).status).toBe(204);
});

it("with files on, a report over any byte limit is refused by the route, with a reason", async () => {
  const big = (size: number): File => ({
    name: "big.log",
    type: "text/plain",
    bytes: new TextEncoder().encode("b".repeat(size)),
  });
  for (const [request, reason] of [
    [postWith(valid(), [padded(PNG, IMAGE_BYTES + 1)], []), "The image is too large."],
    [postWith({ ...valid(), note: "n".repeat(1_048_576) }, [PNG], []), "The report is too large."],
    [postWith(valid(), [PNG], [big(800_001)]), "The file0 part is too large."],
    [
      postWith(valid(), [PNG], [big(400_001), big(400_000)]),
      "The attachments are too large together.",
    ],
  ] as const) {
    const response = await withFiles.POST(request);
    expect(response.status, reason).toBe(413);
    expect(await response.text()).toBe(reason);
  }
  expect(requests).toEqual([]);
  // More files than the limit is a count, not a size: 400.
  const eleven = Array.from({ length: 11 }, (_, i) => ({ ...files[1], name: `log-${i}.log` }));
  expect((await withFiles.POST(postWith(valid(), [PNG], eleven as File[]))).status).toBe(400);
  expect(requests).toEqual([]);
  // The control: at each limit exactly, the same report is stored.
  const fits = postWith(valid(), [padded(PNG, IMAGE_BYTES)], [big(400_000), big(400_000)]);
  expect((await withFiles.POST(fits)).status).toBe(204);
});

it("with files on, each file is stored under the report's folder by its index, and read back as a download", async () => {
  const report = valid();
  expect((await withFiles.POST(postWith(report, [PNG], files))).status).toBe(204);
  // The files before report.json, so it never lacks them, each named by index, not by the user.
  expect(requests).toEqual([
    `GET ${STORE}${at(report.id, "report.json")}`,
    `PUT ${API}?pathname=${encodeURIComponent(at(report.id, "screenshot-0.png"))}`,
    `PUT ${API}?pathname=${encodeURIComponent(at(report.id, "file-0.png"))}`,
    `PUT ${API}?pathname=${encodeURIComponent(at(report.id, "file-1.log"))}`,
    `PUT ${API}?pathname=${encodeURIComponent(at(report.id, "report.json"))}`,
  ]);
  expect(blobs.get(at(report.id, "file-0.png"))).toEqual({
    body: Buffer.from(PNG),
    type: "image/png",
  });
  expect(blobs.get(at(report.id, "file-1.log"))).toEqual({
    body: Buffer.from(LOG),
    type: "text/plain",
  });
  const stored = JSON.parse(String(blobs.get(at(report.id, "report.json"))?.body));
  expect(stored).toEqual({
    ...named(report, "screenshot-0.png"),
    attachments: [
      { name: "Screen shot.png", type: "image/png", size: PNG.length, file: "file-0.png" },
      { name: "Crash Report.LOG", type: "text/plain", size: LOG.length, file: "file-1.log" },
    ],
  });
  for (const [file, type, bytes] of [
    ["file-0.png", "image/png", PNG],
    ["file-1.log", "text/plain", LOG],
  ] as const) {
    const response = await admin.GET(get(String(report.id), file));
    expect(response.status, file).toBe(200);
    expect(response.headers.get("content-type")).toBe(type);
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${file}"`);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  }
  // A screenshot is still shown, not downloaded.
  const shot = await admin.GET(get(String(report.id), "screenshot-0.png"));
  expect(shot.headers.get("content-disposition")).toBeNull();
});

it("with files on, a report without files is stored exactly as with them off", async () => {
  const report = valid();
  expect((await withFiles.POST(post(report, PNG))).status).toBe(204);
  expect(requests).toEqual([
    `GET ${STORE}${at(report.id, "report.json")}`,
    `PUT ${API}?pathname=${encodeURIComponent(at(report.id, "screenshot-0.png"))}`,
    `PUT ${API}?pathname=${encodeURIComponent(at(report.id, "report.json"))}`,
  ]);
  const stored = JSON.parse(String(blobs.get(at(report.id, "report.json"))?.body));
  expect(stored).toEqual(named(report, "screenshot-0.png"));
});

it("a read of a file name the route never stores is refused before Vercel is asked", async () => {
  const id = String(valid().id);
  for (const file of [
    "file-0.exe",
    "file-0.PNG",
    "file-10.png",
    "file-0",
    "file-0.png.html",
    "Screen%20shot.png",
    "file-0.svg",
  ]) {
    expect((await admin.GET(get(id, file))).status, file).toBe(400);
  }
  expect(requests).toEqual([]);
  // The control: a file of every type the server takes is a name the read reaches Vercel with.
  const endings = Object.values(ATTACHMENT_TYPES).flat();
  for (const ending of endings) {
    expect((await admin.GET(get(id, `file-9${ending}`))).status, ending).toBe(404);
  }
  expect(requests).toHaveLength(endings.length);
});

it("with files on, a request that reuses an id cannot replace a stored file", async () => {
  const report = valid();
  await withFiles.POST(postWith(report, [PNG], files));
  const other = new TextEncoder().encode("replaced\n");
  const resend = [files[0], { name: "Crash Report.LOG", type: "text/plain", bytes: other }];
  requests.length = 0;
  expect((await withFiles.POST(postWith(report, [PNG], resend as File[]))).status).toBe(204);
  expect(requests).toEqual([`GET ${STORE}${at(report.id, "report.json")}`]);
  expect(blobs.get(at(report.id, "file-1.log"))?.body).toEqual(Buffer.from(LOG));
});

it("with files on, Try again after a failed file write stores the report and every file", async () => {
  const report = valid();
  failPath = at(report.id, "file-1.log");
  await expect(withFiles.POST(postWith(report, [PNG], files))).rejects.toThrow(
    /500 for file-1\.log/,
  );
  // No report.json without its files, and the files written so far stay for the retry to replace.
  expect(blobs.has(at(report.id, "report.json"))).toBe(false);
  expect(blobs.has(at(report.id, "file-0.png"))).toBe(true);
  failPath = "";
  expect((await withFiles.POST(postWith(report, [PNG], files))).status).toBe(204);
  expect([...blobs.keys()].sort()).toEqual(
    ["file-0.png", "file-1.log", "report.json", "screenshot-0.png"].map((name) =>
      at(report.id, name),
    ),
  );
});
