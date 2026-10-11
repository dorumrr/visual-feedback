import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, it } from "vitest";
import { steps } from "../check.mjs";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const biome = join(repo, "node_modules/.bin/biome");
const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** The repo's lint, with its own config, on a folder holding one source file. */
function lint(source: string) {
  const folder = mkdtempSync(join(tmpdir(), "vf-lint-"));
  folders.push(folder);
  copyFileSync(join(repo, "biome.json"), join(folder, "biome.json"));
  mkdirSync(join(folder, "src"));
  writeFileSync(join(folder, "src/index.ts"), source);
  return spawnSync(biome, ["check", "."], { cwd: folder, encoding: "utf8" });
}

it("npm run check runs the lint first", () => {
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  expect(pkg.scripts.lint).toBe("biome check .");
  expect(pkg.scripts.check).toBe("node tests/check.mjs");
  expect(steps(pkg.scripts)[0]).toBe("lint");
});

it("the lint passes clean code and fails on a planted lint error", () => {
  const clean = lint("export const answer = 1;\n");
  expect(clean.stdout + clean.stderr).toMatch(/Checked 2 files/);
  expect(clean.status).toBe(0);
  const planted = lint("export function stop(): void {\n  debugger;\n}\n");
  expect(planted.stdout + planted.stderr).toMatch(/noDebugger/);
  expect(planted.status).not.toBe(0);
});
