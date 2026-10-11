import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { steps } from "../check.mjs";

const workflow = readFileSync(
  new URL("../../.github/workflows/publish.yml", import.meta.url),
  "utf8",
);
const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/** The shell of one workflow step, by its name, as GitHub would run it. */
function step(name: string): string {
  const start = workflow.indexOf(`- name: ${name}\n`);
  expect(start, name).toBeGreaterThan(-1);
  const [, body = ""] =
    /\n\s+run: \|\n([\s\S]*?)(?=\n\s+- (?:name|uses|run):|$)/.exec(workflow.slice(start)) ?? [];
  const indent = /^ */.exec(body)?.[0].length ?? 0;
  return body
    .split("\n")
    .map((line) => line.slice(indent))
    .join("\n");
}

function gate(version: string, changelog: string) {
  const folder = mkdtempSync(join(tmpdir(), "vf-publish-"));
  folders.push(folder);
  writeFileSync(join(folder, "package.json"), JSON.stringify({ version }));
  writeFileSync(join(folder, "CHANGELOG.md"), changelog);
  // A step with no shell: key runs on Linux as bash -e, without pipefail.
  return spawnSync(
    "bash",
    ["--noprofile", "--norc", "-e", "-c", step("The version has its CHANGELOG entry")],
    {
      cwd: folder,
      encoding: "utf8",
    },
  );
}

it("the publish gate passes a released CHANGELOG heading for the package's version", () => {
  expect(gate("0.1.0", "# Changelog\n\n## 0.1.0 (2026-10-11)\n\n- x\n").status).toBe(0);
  expect(gate("0.1.0", "# Changelog\n\n## 0.1.0\n\n- x\n").status).toBe(0);
});

it("the publish gate refuses a missing entry, another version, and a heading not yet released", () => {
  expect(gate("0.1.0", "# Changelog\n\n## 0.0.9\n").status).toBe(1);
  expect(gate("0.1.0", "# Changelog\n\n## 0.1.01 (2026-10-11)\n").status).toBe(1);
  expect(gate("0.1.0", "# Changelog\n\n## 0x1y0 (2026-10-11)\n").status).toBe(1);
  for (const heading of ["(not released yet)", "(Unreleased)", "(not yet released)"]) {
    const unreleased = gate("0.1.0", `# Changelog\n\n## 0.1.0 ${heading}\n\n- x\n`);
    expect(unreleased.status, heading).toBe(1);
    expect(unreleased.stdout, heading).toMatch(/not released/);
  }
});

/** Runs the wait-for-check step with a fake gh that answers each call with the next state. */
function waitForCheck(states: string[]) {
  const folder = mkdtempSync(join(tmpdir(), "vf-publish-"));
  folders.push(folder);
  writeFileSync(join(folder, "states.json"), JSON.stringify(states));
  const fake = join(folder, "gh");
  writeFileSync(
    fake,
    `#!/usr/bin/env node
const fs = require("node:fs");
const file = ${JSON.stringify(join(folder, "states.json"))};
const [next = "", ...rest] = JSON.parse(fs.readFileSync(file, "utf8"));
fs.writeFileSync(file, JSON.stringify(rest));
fs.appendFileSync(${JSON.stringify(join(folder, "calls"))}, process.argv.slice(2).join(" ") + "\\n");
if (next === "error") process.exit(1);
process.stdout.write(next + "\\n");
`,
    { mode: 0o755 },
  );
  const result = spawnSync(
    "bash",
    ["--noprofile", "--norc", "-e", "-c", step("This commit passed check")],
    {
      cwd: folder,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${folder}:${process.env.PATH}`,
        GITHUB_SHA: "abc123",
        CHECK_WAIT: "0",
        CHECK_TRIES: "5",
      },
    },
  );
  const calls = readFileSync(join(folder, "calls"), "utf8").trim().split("\n");
  return { ...result, calls };
}

it("publishing waits for check.yml to pass on the same commit", () => {
  const passed = waitForCheck(["null null", "in_progress ", "error", "completed success"]);
  expect(passed.status).toBe(0);
  expect(passed.calls).toHaveLength(4);
  expect(passed.calls[0]).toContain("--workflow check.yml");
  expect(passed.calls[0]).toContain("--commit abc123");
});

it("publishing stops when check.yml failed, was cancelled, or never finished", () => {
  for (const end of ["completed failure", "completed cancelled"]) {
    const stopped = waitForCheck(["in_progress ", end]);
    expect(stopped.status, end).toBe(1);
    expect(stopped.stdout, end).toMatch(/did not pass/);
  }
  const late = waitForCheck(Array(10).fill("in_progress "));
  expect(late.status).toBe(1);
  expect(late.calls).toHaveLength(5);
  expect(late.stdout).toMatch(/did not finish/);
});

it("check.yml runs all of npm run check: the static half, and each browser test per browser", () => {
  const ci = readFileSync(new URL("../../.github/workflows/check.yml", import.meta.url), "utf8");
  const { scripts } = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };
  // npm run check runs exactly the two halves CI runs.
  expect(scripts.check).toBe("node tests/check.mjs");
  expect(steps(scripts)).toEqual(
    [scripts["check:static"], scripts["check:browser"]].flatMap((chain) =>
      [...(chain ?? "").matchAll(/npm run ([\w:]+)/g)].map((match) => match[1]),
    ),
  );
  expect(ci).toContain("- run: npm run check:static\n");
  const browser = [...(scripts["check:browser"] ?? "").matchAll(/npm run ([\w:]+)/g)].map(
    (match) => match[1],
  );
  expect(browser.length).toBeGreaterThan(2);
  for (const name of browser) {
    expect(ci).toContain(`- run: npm run ${name} -- --project=\${{ matrix.browser }}\n`);
  }
  const listed = /browser: \[([^\]]*)\]/.exec(ci)?.[1]?.split(", ");
  expect(listed).toEqual(["chromium", "firefox", "webkit"]);
});
