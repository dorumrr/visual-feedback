import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AwsV4Signer } from "aws4fetch";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { PNG, valid, WEBP } from "../server/sample";
import { recipe, SERVER } from "./doc";

const { doc, block, load, cleanup } = recipe("s3.md");

type Route = {
  POST(request: Request): Promise<Response>;
  GET(request: Request): Promise<Response>;
};

type Put = { method: string; key: string; headers: IncomingHttpHeaders };

// A fake S3: it checks each signature as S3 would, keeps objects by key, logs every request, and
// refuses a chosen key with the chosen status.
const objects = new Map<string, { body: Buffer; type: string }>();
const requests: Put[] = [];
let failKey = "";
let failStatus = 403;
let region = "auto";
const SECRET = "test-secret-not-real";
let server: Server;
let endpoint = "";

let route: Route;
let admin: Route;
const saved = { ...process.env };

beforeAll(async () => {
  server = createServer((req, res) => {
    const key = decodeURIComponent(new URL(req.url ?? "", "http://x").pathname);
    requests.push({ method: req.method ?? "", key, headers: req.headers });
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      // Re-sign with the secret, region and service a real bucket expects; S3 refuses a mismatch.
      const auth = String(req.headers.authorization ?? "");
      const signedHeaders = /SignedHeaders=([^,]+)/.exec(auth)?.[1]?.split(";") ?? [];
      const headers = Object.fromEntries(
        signedHeaders
          .filter((name) => name !== "host")
          .map((name) => [name, String(req.headers[name])]),
      );
      const expected = await new AwsV4Signer({
        method: req.method ?? "GET",
        url: `${endpoint}${req.url}`,
        headers,
        accessKeyId: "TESTKEYID",
        secretAccessKey: SECRET,
        region,
        service: "s3",
        datetime: String(req.headers["x-amz-date"]),
      }).sign();
      if (expected.headers.get("authorization") !== auth) return res.writeHead(403).end();
      if (key === failKey) return res.writeHead(failStatus).end();
      if (req.method === "PUT") {
        // S3 and R2 keep an existing object when the PUT says If-None-Match: *.
        if (req.headers["if-none-match"] === "*" && objects.has(key)) {
          return res.writeHead(412).end();
        }
        objects.set(key, {
          body: Buffer.concat(chunks),
          type: String(req.headers["content-type"]),
        });
        return res.writeHead(200).end();
      }
      const object = objects.get(key);
      if (!object) return res.writeHead(404).end();
      res.writeHead(200, { "content-type": object.type }).end(object.body);
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const source = block("ts");
  const imports = {
    "visual-feedback/server": SERVER,
    aws4fetch: import.meta.resolve("aws4fetch"),
  };
  route = await load<Route>(source, imports);
  // The host's own check, filled in as the doc asks; the test admin is a request header.
  const check = "  return false;\n}";
  expect(source.split(check)).toHaveLength(2);
  const filled = source.replace(
    check,
    '  return _request.headers.get("x-test-admin") === "yes";\n}',
  );
  admin = await load<Route>(filled, imports);
});

afterAll(async () => {
  cleanup();
  await new Promise((done) => server.close(done));
});

beforeEach(() => {
  objects.clear();
  requests.length = 0;
  failKey = "";
  failStatus = 403;
  region = "auto";
  for (const name of Object.keys(process.env)) if (name.startsWith("S3_")) delete process.env[name];
  Object.assign(process.env, {
    S3_ENDPOINT: endpoint,
    S3_REGION: "auto",
    S3_BUCKET: "bucket-test",
    S3_ACCESS_KEY_ID: "TESTKEYID",
    S3_SECRET_ACCESS_KEY: SECRET,
  });
});

afterEach(() => {
  for (const name of Object.keys(process.env)) if (name.startsWith("S3_")) delete process.env[name];
  for (const [name, value] of Object.entries(saved)) {
    if (name.startsWith("S3_")) process.env[name] = value;
  }
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

const key = (id: unknown, file: string) => `/bucket-test/feedback/${String(id)}/${file}`;

it("a report sent through the recipe lands in the bucket, image first, signed with the key", async () => {
  const report = valid();
  expect((await route.POST(post(report, PNG))).status).toBe(204);
  expect(requests.map((r) => `${r.method} ${r.key}`)).toEqual([
    `HEAD ${key(report.id, "report.json")}`,
    `PUT ${key(report.id, "image.png")}`,
    `PUT ${key(report.id, "report.json")}`,
  ]);
  expect(objects.get(key(report.id, "image.png"))).toEqual({
    body: Buffer.from(PNG),
    type: "image/png",
  });
  const stored = objects.get(key(report.id, "report.json"));
  expect(stored?.type).toBe("application/json");
  expect(JSON.parse(String(stored?.body))).toEqual({ ...report, image: "image.png" });
  for (const { headers } of requests) {
    expect(String(headers.authorization)).toMatch(/^AWS4-HMAC-SHA256 Credential=TESTKEYID\//);
    // Private: nothing asks the bucket to make an object public or grant anyone access.
    expect(Object.keys(headers).filter((name) => /^x-amz-(acl|grant-)/.test(name))).toEqual([]);
  }
});

it("the host's checked route reads the report and the image back from the bucket", async () => {
  const report = valid();
  await route.POST(post(report, PNG));
  const json = await admin.GET(get(String(report.id), "report.json"));
  expect(json.status).toBe(200);
  expect(await json.json()).toEqual({ ...report, image: "image.png" });
  expect(json.headers.get("cache-control")).toBe("private, no-store");
  const image = await admin.GET(get(String(report.id), "image.png"));
  expect(image.headers.get("content-type")).toBe("image/png");
  expect(image.headers.get("cache-control")).toBe("private, no-store");
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);
});

it("until the host fills in its own check, nobody can read, and the bucket is not asked", async () => {
  const report = valid();
  await route.POST(post(report, PNG));
  requests.length = 0;
  // Even the request the filled-in check would allow is refused by the doc's code as written.
  expect((await route.GET(get(String(report.id), "report.json"))).status).toBe(403);
  expect((await admin.GET(get(String(report.id), "report.json", false))).status).toBe(403);
  expect(requests).toEqual([]);
});

it("a read for any other key is refused before the bucket is asked", async () => {
  for (const [id, file] of [
    ["../other/x", "report.json"],
    ["0b6c3a52-7f1e-4c2a-9d3b-5e8f0a1b2c3d", "../../secret"],
    ["0b6c3a52-7f1e-4c2a-9d3b-5e8f0a1b2c3d", "notes.txt"],
    ["0b6c3a52-7f1e-4c2a-9d3b-5e8f0a1b2c3d", "image.jpg"],
    ["0B6C3A52-7F1E-4C2A-9D3B-5E8F0A1B2C3D", "report.json"],
    ["", "report.json"],
    ["0b6c3a52-7f1e-4c2a-9d3b-5e8f0a1b2c3d", ""],
  ] as const) {
    expect((await admin.GET(get(id, file))).status, `${id} ${file}`).toBe(400);
  }
  expect(requests).toEqual([]);
  // The control: a well-formed read does reach the bucket.
  expect((await admin.GET(get("0b6c3a52-7f1e-4c2a-9d3b-5e8f0a1b2c3d", "report.json"))).status).toBe(
    404,
  );
  expect(requests).toHaveLength(1);
});

it("a report with no image stores report.json alone, with image: null", async () => {
  const report: Record<string, unknown> = { ...valid(), marks: [] };
  expect((await route.POST(post(report))).status).toBe(204);
  expect([...objects.keys()]).toEqual([key(report.id, "report.json")]);
  expect(JSON.parse(String(objects.get(key(report.id, "report.json"))?.body)).image).toBeNull();
});

it("when the bucket refuses the image, no report.json is written without it", async () => {
  const report = valid();
  failKey = key(report.id, "image.png");
  await expect(route.POST(post(report, PNG))).rejects.toThrow(/403 for image\.png/);
  expect(objects.has(key(report.id, "report.json"))).toBe(false);
});

it("a request that reuses a stored report's id replaces neither the report nor its image", async () => {
  const report = valid();
  await route.POST(post(report, PNG));
  const forged = { ...report, note: "forged" };
  expect((await route.POST(post(forged, Uint8Array.of(...PNG, 0)))).status).toBe(204);
  expect((await route.POST(post(forged, WEBP, "image/webp"))).status).toBe(204);
  expect(objects.get(key(report.id, "image.png"))?.body).toEqual(Buffer.from(PNG));
  expect(objects.has(key(report.id, "image.webp"))).toBe(false);
  expect(JSON.parse(String(objects.get(key(report.id, "report.json"))?.body)).note).toBe(
    report.note,
  );
});

it("when the bucket cannot say whether the report is stored, nothing is written", async () => {
  const report = valid();
  failKey = key(report.id, "report.json");
  failStatus = 500;
  await expect(route.POST(post(report, PNG))).rejects.toThrow(/500 for report\.json/);
  expect(requests.filter((r) => r.method === "PUT")).toEqual([]);
});

it("Try again after a failed report.json write keeps the image already stored", async () => {
  const report = valid();
  failKey = key(report.id, "report.json");
  await expect(route.POST(post(report, PNG))).rejects.toThrow(/403 for report\.json/);
  failKey = "";
  // Every write is create-only, so a second image under the same id cannot replace the first.
  expect((await route.POST(post(report, Uint8Array.of(...PNG, 0)))).status).toBe(204);
  expect(objects.get(key(report.id, "image.png"))?.body).toEqual(Buffer.from(PNG));
  expect(JSON.parse(String(objects.get(key(report.id, "report.json"))?.body)).id).toBe(report.id);
  for (const put of requests.filter((r) => r.method === "PUT")) {
    expect(put.headers["if-none-match"]).toBe("*");
  }
});

it("a request the parser refuses gets its status, and the bucket is not asked", async () => {
  const spoofed = new TextEncoder().encode("<svg/>");
  expect((await route.POST(post(valid(), spoofed))).status).toBe(400);
  expect(requests).toEqual([]);
});

it("the widget's endpoint in the recipe is the path its route file serves", () => {
  expect(doc).toContain('createFeedback({ endpoint: "/api/feedback" })');
  expect(block("ts")).toMatch(/^\/\/ app\/api\/feedback\/route\.ts$/m);
  expect(block("sh")).toBe("npm install aws4fetch\n");
});

it("a WebP report, as Chromium and Firefox send, is stored and read back as image.webp", async () => {
  const report = valid();
  expect((await route.POST(post(report, WEBP, "image/webp"))).status).toBe(204);
  const image = await admin.GET(get(String(report.id), "image.webp"));
  expect(image.headers.get("content-type")).toBe("image/webp");
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(WEBP);
  expect(JSON.parse(String(objects.get(key(report.id, "report.json"))?.body)).image).toBe(
    "image.webp",
  );
});

it("a signature made with the wrong secret is refused by the fake bucket, as S3 would", async () => {
  process.env.S3_SECRET_ACCESS_KEY = "a-wrong-secret";
  await expect(route.POST(post(valid(), PNG))).rejects.toThrow(/403 for image\.png/);
  expect(objects.size).toBe(0);
});

it("a bucket that answers 5xx gives up after a short retry, so the user can try again soon", async () => {
  const report = valid();
  failKey = key(report.id, "image.png");
  failStatus = 500;
  const started = performance.now();
  await expect(route.POST(post(report, PNG))).rejects.toThrow(/500 for image\.png/);
  expect(performance.now() - started).toBeLessThan(3000);
  expect(requests.filter((r) => r.key === failKey)).toHaveLength(3);
});

it("missing settings are a clear error, and nothing is sent anywhere", async () => {
  for (const name of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
    const value = process.env[name];
    delete process.env[name];
    await expect(route.POST(post(valid(), PNG)), name).rejects.toThrow(
      /Set S3_ENDPOINT, S3_BUCKET/,
    );
    process.env[name] = value;
  }
  expect(requests).toEqual([]);
});

it("an endpoint pasted with a trailing slash still reaches the same keys", async () => {
  process.env.S3_ENDPOINT = `${endpoint}/`;
  const report = valid();
  expect((await route.POST(post(report, PNG))).status).toBe(204);
  expect(objects.has(key(report.id, "report.json"))).toBe(true);
});

it("a missing object reads as 404, also where the bucket answers 403 for it, as AWS does", async () => {
  const id = "0b6c3a52-7f1e-4c2a-9d3b-5e8f0a1b2c3d";
  expect((await admin.GET(get(id, "report.json"))).status).toBe(404);
  failKey = key(id, "report.json");
  expect((await admin.GET(get(id, "report.json"))).status).toBe(404);
  failStatus = 500;
  // The control: a real bucket failure still reads as a bad gateway.
  expect((await admin.GET(get(id, "report.json"))).status).toBe(502);
});

it("an empty S3_REGION signs as auto, the same as an unset one", async () => {
  process.env.S3_REGION = "";
  expect((await route.POST(post(valid(), PNG))).status).toBe(204);
});

it("the region comes from S3_REGION, as an AWS bucket needs", async () => {
  process.env.S3_REGION = "eu-west-2";
  region = "eu-west-2";
  expect((await route.POST(post(valid(), PNG))).status).toBe(204);
  // The control: the fake refuses a request signed for another region.
  process.env.S3_REGION = "auto";
  await expect(route.POST(post(valid(), PNG))).rejects.toThrow(/403/);
});
