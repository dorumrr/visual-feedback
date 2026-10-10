import { createReadStream, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("fixtures", import.meta.url));
const dist = fileURLToPath(new URL("../dist", import.meta.url));
const port = Number(process.env.FIXTURE_PORT ?? 4173);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const vendor = {
  "/vendor/snapdom.js": "../node_modules/@zumer/snapdom/dist/snapdom.js",
  "/vendor/snapdom.mjs": "../node_modules/@zumer/snapdom/dist/snapdom.mjs",
};
// A browser cannot resolve the bare import a bundler would, so the built files get a path instead.
const BARE = /(["'])@zumer\/snapdom\1/g;

// snapdom 3.3.0 cuts -webkit-line-clamp text one line short at a fractional line height. Only the
// copy served here is fixed, for the tests and the playground; a host's install is not (SPEC §5).
const CLAMP = "t.scrollHeight<=c+.5";
const { version } = JSON.parse(
  readFileSync(new URL("../node_modules/@zumer/snapdom/package.json", import.meta.url), "utf8"),
);
if (version !== "3.3.0")
  throw new Error(`serve: the line-clamp fix is for snapdom 3.3.0, not ${version}`);
const snapdom = Object.fromEntries(
  Object.entries(vendor).map(([path, file]) => {
    const code = readFileSync(new URL(file, import.meta.url), "utf8");
    const sites = code.split(CLAMP).length - 1;
    if (sites !== 2) throw new Error(`serve: ${file} holds ${sites} line-clamp sites, not 2`);
    // The limit, c, is a rounded one-line height times the lines, n: allow one pixel per line.
    return [path, code.replaceAll(CLAMP, "t.scrollHeight<=c+n")];
  }),
);

function inside(base, pathname) {
  const path = normalize(join(base, pathname));
  return path === base || path.startsWith(base + sep) ? path : null;
}

function resolve(pathname) {
  if (pathname.startsWith("/dist/")) return inside(dist, pathname.slice("/dist".length));
  const path = inside(root, pathname);
  if (path === null) return null;
  return statSync(path).isDirectory() ? join(path, "index.html") : path;
}

// A fake feedback endpoint for the send tests: it keeps what each key received, answers 500 to
// the first `fail` posts of a key, or redirects with `redirect`. GET returns what it kept.
const received = new Map();

function endpoint(req, res, url) {
  const key = url.pathname.slice("/api/feedback/".length);
  const list = received.get(key) ?? [];
  received.set(key, list);
  if (req.method === "GET") {
    return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(list));
  }
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    list.push({ headers: req.headers, body: Buffer.concat(chunks).toString("base64") });
    if (url.searchParams.has("redirect")) {
      return res.writeHead(302, { location: "/widget/capture.html" }).end();
    }
    const fail = list.length <= Number(url.searchParams.get("fail") ?? 0);
    res.writeHead(fail ? 500 : 204).end();
  });
}

const handler = (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/feedback/")) return endpoint(req, res, url);
  if (Object.hasOwn(snapdom, url.pathname)) {
    return res
      .writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" })
      .end(snapdom[url.pathname]);
  }
  try {
    const file = resolve(decodeURIComponent(url.pathname));
    if (file === null) return res.writeHead(403).end();
    if (!statSync(file).isFile()) return res.writeHead(404).end();
    res.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      // The playground must always load the newest build.
      "cache-control": "no-store",
    });
    if (file.startsWith(dist + sep) && extname(file) === ".mjs") {
      return res.end(readFileSync(file, "utf8").replace(BARE, '"/vendor/snapdom.mjs"'));
    }
    createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
  } catch {
    res.writeHead(404).end();
  }
};

createServer(handler).listen(port, "127.0.0.1");
// A second origin for cross-origin fixtures; it sends no CORS headers.
createServer(handler).listen(port + 1, "127.0.0.1");
