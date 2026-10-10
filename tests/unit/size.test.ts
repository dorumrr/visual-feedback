import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

const repo = fileURLToPath(new URL("../..", import.meta.url));
let copy = "";

// A copy, so building here never races the pack test's build of the real dist/.
beforeAll(() => {
  copy = mkdtempSync(join(tmpdir(), "vf-size-"));
  for (const path of [
    "package.json",
    "tsconfig.json",
    "tsdown.config.ts",
    ".size-limit.json",
    "src",
  ]) {
    cpSync(join(repo, path), join(copy, path), { recursive: true });
  }
  symlinkSync(join(repo, "node_modules"), join(copy, "node_modules"), "dir");
  const build = spawnSync(
    process.execPath,
    ["node_modules/tsdown/dist/run.mjs", "--logLevel", "warn"],
    {
      cwd: copy,
      encoding: "utf8",
    },
  );
  if (build.status !== 0) throw new Error(build.stderr);
}, 60_000);

afterAll(() => {
  if (copy) rmSync(copy, { recursive: true, force: true });
});

function sizeLimit() {
  const run = spawnSync(process.execPath, ["node_modules/size-limit/bin.js", "--json"], {
    cwd: copy,
    encoding: "utf8",
  });
  const [loader, dialog] = JSON.parse(run.stdout) as {
    name: string;
    size: number;
    passed: boolean;
  }[];
  return { status: run.status, loader, dialog };
}

/** Measures with random bytes added to one built file, then puts the file back. */
function planted(file: string, bytes: number) {
  const path = join(copy, "dist", file);
  const original = readFileSync(path, "utf8");
  appendFileSync(path, `export const planted = "${randomBytes(bytes).toString("base64")}";\n`);
  try {
    return sizeLimit();
  } finally {
    writeFileSync(path, original);
  }
}

it("the dialog is a separate file that the loader imports only on open", () => {
  const files = readdirSync(join(copy, "dist"));
  const chunk = files.find((file) => /^dialog-.+\.mjs$/.test(file));
  expect(chunk).toBeDefined();
  // The loader is index.mjs with the chunks it imports statically, shared with the React entry.
  const entry = readFileSync(join(copy, "dist", "index.mjs"), "utf8");
  const shared = [...entry.matchAll(/^(?:import|export) .* from "\.\/([\w-]+\.mjs)";$/gm)].map(
    (match) => readFileSync(join(copy, "dist", match[1] ?? "missing"), "utf8"),
  );
  const loader = [entry, ...shared].join("\n");
  // The React entry reuses the same chunk, so a page with both carries one copy of the widget.
  const react = readFileSync(join(copy, "dist", "react.mjs"), "utf8");
  const chunks = [...entry.matchAll(/from "\.\/([\w-]+\.mjs)"/g)].map((match) => match[1]);
  expect(chunks.length).toBeGreaterThan(0);
  for (const name of chunks) expect(react).toContain(`from "./${name}"`);
  expect(react).not.toContain("attachShadow");
  // Only the component: a copy of any widget logic would be far larger.
  expect(react.length).toBeLessThan(1500);
  expect(loader).toContain(`import("./${chunk}")`);
  expect(loader).not.toMatch(/^import .*dialog/m);
  expect(loader).not.toContain("showModal");
  // The annotator is in this chunk, so the dialog's budget counts it.
  expect(readFileSync(join(copy, "dist", chunk ?? "missing"), "utf8")).toContain(
    "setPointerCapture",
  );
});

it("the budgets are 15 KB for the loader and 135 KB for the dialog, as SPEC §9 says", () => {
  const limits = JSON.parse(readFileSync(join(repo, ".size-limit.json"), "utf8")).map(
    (entry: { limit: string }) => entry.limit,
  );
  expect(limits).toEqual(["15 KB", "135 KB"]);
  const spec = readFileSync(join(repo, "docs/SPEC.md"), "utf8");
  expect(spec).toContain("(the trigger and the `open()` wiring): 15 KB or less");
  expect(spec).toContain("**Annotator and dialog:** 135 KB or less");
});

it("the loader has a measured size within its budget, and an over-budget build fails", () => {
  const within = sizeLimit();
  expect(within.loader?.name).toBe("loader");
  expect(within.loader?.size).toBeGreaterThan(0);
  expect(within.loader?.passed).toBe(true);
  expect(within.status).toBe(0);

  const over = planted("index.mjs", 16384);
  expect(over.loader?.size).toBeGreaterThan(15000);
  expect(over.loader?.passed).toBe(false);
  expect(over.status).not.toBe(0);
}, 60_000);

it("the annotator and dialog have a measured size within their budget, and an over-budget build fails", () => {
  const within = sizeLimit();
  expect(within.dialog?.name).toBe("annotator and dialog");
  expect(within.dialog?.size).toBeGreaterThan(1000);
  expect(within.dialog?.passed).toBe(true);
  expect(within.status).toBe(0);

  const chunk = readdirSync(join(copy, "dist")).find((file) => /^dialog-.+\.mjs$/.test(file));
  const over = planted(chunk ?? "missing", 184320);
  expect(over.dialog?.size).toBeGreaterThan(135000);
  expect(over.dialog?.passed).toBe(false);
  expect(over.status).not.toBe(0);
}, 60_000);
