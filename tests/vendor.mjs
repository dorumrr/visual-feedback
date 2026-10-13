// The snapdom copy the tests, the playground and its demo site load, and the built files pointed at it.
import { readFileSync } from "node:fs";

// A browser cannot resolve the bare import a bundler would, so the built files get a path instead:
// dist/ and vendor/ sit side by side, at the root of the test server and of the demo site.
const BARE = /(["'])@zumer\/snapdom\1/g;
export const pointed = (code) => code.replace(BARE, '"../vendor/snapdom.mjs"');

// snapdom 3.3.0 cuts -webkit-line-clamp text one line short at a fractional line height. Only this
// copy is fixed, for the tests, the playground and its demo site; a host's install is not (SPEC §5).
const CLAMP = "t.scrollHeight<=c+.5";
const { version } = JSON.parse(
  readFileSync(new URL("../node_modules/@zumer/snapdom/package.json", import.meta.url), "utf8"),
);
if (version !== "3.3.0")
  throw new Error(`vendor: the line-clamp fix is for snapdom 3.3.0, not ${version}`);
/** Each fixed file by its path under the site's root, as vendor/snapdom.mjs. */
export const snapdom = Object.fromEntries(
  ["snapdom.js", "snapdom.mjs"].map((name) => {
    const file = `../node_modules/@zumer/snapdom/dist/${name}`;
    const code = readFileSync(new URL(file, import.meta.url), "utf8");
    const sites = code.split(CLAMP).length - 1;
    if (sites !== 2) throw new Error(`vendor: ${file} holds ${sites} line-clamp sites, not 2`);
    // The limit, c, is a rounded one-line height times the lines, n: allow one pixel per line.
    return [`vendor/${name}`, code.replaceAll(CLAMP, "t.scrollHeight<=c+n")];
  }),
);
