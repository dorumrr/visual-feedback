// npm run site: the playground as static files, the demo site on GitHub Pages. Run it after
// npm run build. It writes artifacts/site, or the empty or new folder given.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pointed, snapdom } from "./vendor.mjs";

const from = (path) => fileURLToPath(new URL(path, import.meta.url));
const fallback = from("../artifacts/site");
const out = resolve(process.argv[2] ?? fallback);
// Only its own folder is cleared: a folder given by mistake is never emptied.
if (out === fallback) rmSync(out, { recursive: true, force: true });
else if (existsSync(out) && readdirSync(out).length > 0) {
  throw new Error(`site: ${out} is not empty`);
}
const built = readdirSync(from("../dist")).filter((name) => name.endsWith(".mjs"));
if (!built.includes("index.mjs"))
  throw new Error("site: no dist/index.mjs: run npm run build first");

mkdirSync(join(out, "dist"), { recursive: true });
mkdirSync(join(out, "vendor"));
cpSync(from("fixtures/index.html"), join(out, "index.html"));
cpSync(from("fixtures/playground"), join(out, "playground"), { recursive: true });
for (const name of built) {
  writeFileSync(join(out, "dist", name), pointed(readFileSync(from(`../dist/${name}`), "utf8")));
}
writeFileSync(join(out, "vendor/snapdom.mjs"), snapdom["vendor/snapdom.mjs"]);
console.log(`site: ${out}`);
