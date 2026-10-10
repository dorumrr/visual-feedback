import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";

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
