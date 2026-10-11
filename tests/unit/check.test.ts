import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, it } from "vitest";
import { ends, plain, steps } from "../check.mjs";

const runner = fileURLToPath(new URL("../check.mjs", import.meta.url));
const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** npm run check, as the runner runs it, in a project of its own with these scripts. */
function check(scripts: Record<string, string>, before?: (folder: string) => void) {
  const folder = mkdtempSync(join(tmpdir(), "vf-check-"));
  folders.push(folder);
  before?.(folder);
  writeFileSync(join(folder, "package.json"), JSON.stringify({ name: "fake", scripts }));
  const result = spawnSync(process.execPath, [runner], { cwd: folder, encoding: "utf8" });
  return { ...result, folder };
}

it("reads the steps from check:static, then check:browser", () => {
  expect(
    steps({ "check:static": "npm run lint && npm run build", "check:browser": "npm run test:e2e" }),
  ).toEqual(["lint", "build", "test:e2e"]);
});

it("runs every step after a failure, sums them up, and gives a block to paste with each failure", () => {
  const run = check(
    {
      "check:static": "npm run first && npm run second",
      "check:browser": "npm run third && npm run fourth",
      first: 'node -e "console.log(1)"',
      second: `node -e "console.log('\\u001b[31mboom at line ' + 7 + '\\u001b[0m'); process.exit(3)"`,
      third: 'node -e "console.log(3)"',
      // A failure in the browser half, told on stderr only, as tsc and Playwright do. The messages
      // are built when they run: npm prints each command, and a literal would match from there.
      fourth: `node -e "for (let i = 1; i <= 200; i++) console.error('progress ' + i + '\\\\r'); console.error('stderr ' + 'only: ' + 2 + ' failed'); process.exit(1)"`,
    },
    // A log left by an earlier run must not sit beside this run's.
    (folder) => {
      mkdirSync(join(folder, "artifacts/check"), { recursive: true });
      writeFileSync(join(folder, "artifacts/check/3-third.log"), "an old failure\n");
    },
  );
  expect(run.status).toBe(1);
  expect(run.stdout).toMatch(/npm run check: 2 passed, 2 failed, in \d+s/);
  expect(run.stdout).toMatch(/PASS {2}first /);
  expect(run.stdout).toMatch(/FAIL {2}second /);
  // The steps after the failure still ran.
  expect(run.stdout).toMatch(/PASS {2}third /);
  expect(run.stdout).toMatch(/FAIL {2}fourth /);
  const block = /----- copy from here -----\n([\s\S]*)\n----- copy to here -----/.exec(
    run.stdout,
  )?.[1];
  expect(block).toMatch(/^npm run check failed: second, fourth\./);
  expect(block).toContain("## second: npm run second, exit 3");
  expect(block).toContain("boom at line 7");
  expect(block).toContain("## fourth: npm run fourth, exit 1");
  expect(block).toContain("stderr only: 2 failed");
  // No colour codes in what gets pasted.
  expect(block).not.toContain("\u001b");
  expect(readFileSync(join(run.folder, "artifacts/check/failed.md"), "utf8")).toBe(`${block}\n`);
  expect(readFileSync(join(run.folder, "artifacts/check/2-second.log"), "utf8")).toContain(
    "boom at line 7",
  );
  expect(readFileSync(join(run.folder, "artifacts/check/4-fourth.log"), "utf8")).toContain(
    "stderr only: 2 failed",
  );
  expect(existsSync(join(run.folder, "artifacts/check/3-third.log"))).toBe(false);
  // The long stderr step is cut in the block, keeping both ends, with no \r left in it.
  expect(block).toMatch(
    /\(first 30 and last 90 of \d+ lines; all in artifacts.check.4-fourth\.log\)/,
  );
  expect(block).toMatch(/\[\.\.\. \d+ lines cut \.\.\.\]/);
  expect(block).not.toContain("\r");
});

it("a run with no failure says so, exits 0, and leaves no earlier failure behind", () => {
  const run = check(
    {
      "check:static": "npm run only",
      "check:browser": "",
      only: 'node -e "console.log(1)"',
    },
    (folder) => {
      mkdirSync(join(folder, "artifacts/check"), { recursive: true });
      writeFileSync(join(folder, "artifacts/check/failed.md"), "an old failure\n");
    },
  );
  expect(run.status).toBe(0);
  expect(run.stdout).toMatch(/npm run check: 1 passed, 0 failed, in \d+s/);
  expect(run.stdout).not.toContain("copy from here");
  expect(existsSync(join(run.folder, "artifacts/check"))).toBe(false);
});

it("refuses a step it cannot run, rather than skip it and pass", () => {
  for (const scripts of [
    { "check:static": "npm run a && node tests/x.mjs", "check:browser": "", a: "echo a" },
    { "check:static": "", "check:browser": "" },
  ]) {
    const run = check(scripts);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/must be "npm run <script>" steps/);
    expect(run.stdout).not.toMatch(/passed/);
  }
});

it("keeps what a terminal shows, and both ends of a long output", () => {
  // Progress redrawn with \r and cleared with ESC [2K leaves only its last state.
  expect(plain("run 1/3\rrun 2/3\r\u001b[2Krun 3/3 done\r\nnext")).toBe("run 3/3 done\nnext");
  const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
  const kept = ends(lines).split("\n");
  expect(kept.slice(0, 2)).toEqual(["line 1", "line 2"]);
  expect(kept[30]).toBe("[... 80 lines cut ...]");
  expect(kept.at(-1)).toBe("line 200");
  expect(kept).toHaveLength(121);
  expect(ends(lines.slice(0, 120))).toBe(lines.slice(0, 120).join("\n"));
});
