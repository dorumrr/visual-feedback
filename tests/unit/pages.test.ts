import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { shell } from "./workflow";

const workflow = readFileSync(
  new URL("../../.github/workflows/pages.yml", import.meta.url),
  "utf8",
);
const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

/**
 * Runs the newest-commit step with a fake gh: main is at `main`, and check passed on the commits
 * in `passed`. Returns the step's status, its output file and the gh calls it made.
 */
function newest(main: string | undefined, passed: string[]) {
  const folder = mkdtempSync(join(tmpdir(), "vf-pages-"));
  folders.push(folder);
  writeFileSync(
    join(folder, "gh"),
    `#!/usr/bin/env node
const args = process.argv.slice(2);
require("node:fs").appendFileSync(${JSON.stringify(join(folder, "calls"))}, args.join(" ") + "\\n");
const flag = (name) => args[args.indexOf(name) + 1];
if (process.env.GH_TOKEN !== "t") process.exit(4);
if (args[0] === "api" && args[1] === "repos/o/r/commits/main" && flag("--jq") === ".sha") {
  if (${JSON.stringify(main ?? null)} === null) process.exit(1);
  process.stdout.write(${JSON.stringify(main ?? "")} + "\\n");
} else if (args[0] === "run" && args[1] === "list" && args.includes("check.yml")) {
  const sha = flag("--commit");
  const ok = flag("--status") === "success" && flag("--event") === "push" && flag("--repo") === "o/r" &&
    flag("--workflow") === "check.yml" && flag("--json") === "databaseId" && flag("--jq") === "length";
  process.stdout.write((ok && ${JSON.stringify(passed)}.includes(sha) ? "1" : "0") + "\\n");
} else process.exit(2);
`,
    { mode: 0o755 },
  );
  const output = join(folder, "output");
  writeFileSync(output, "");
  const run = spawnSync(
    "bash",
    ["--noprofile", "--norc", "-e", "-c", shell(workflow, "Main's newest commit passed check")],
    {
      cwd: folder,
      encoding: "utf8",
      env: {
        PATH: `${folder}:${process.env.PATH}`,
        GITHUB_REPOSITORY: "o/r",
        GH_TOKEN: "t",
        GITHUB_OUTPUT: output,
      },
    },
  );
  return { status: run.status, output: readFileSync(output, "utf8").trim() };
}

it("the demo site deploys main's newest commit, only once check passed on it", () => {
  expect(newest("bbb", ["aaa", "bbb"])).toEqual({ status: 0, output: "sha=bbb" });
  // An older commit's run, or one started by hand, still deploys main's newest.
  expect(newest("bbb", ["aaa"])).toEqual({ status: 0, output: "" });
  // main unreadable: the run fails where it shows, rather than skipping as if nothing were new.
  expect(newest(undefined, ["aaa"]).status).not.toBe(0);
});

it("the Pages workflow builds and deploys only what that step chose", () => {
  const gated = workflow.split("\n").filter((line) => /^\s+- /.test(line));
  // Every build step after the choice waits for it, and deploy waits for the build's choice.
  const after = gated.slice(gated.findIndex((line) => line.includes("Main's newest")) + 1);
  expect(after.length).toBeGreaterThan(5);
  for (const line of after.filter((line) => !line.includes("id: deployment"))) {
    expect(line).toContain("if: steps.newest.outputs.sha != ''");
  }
  expect(workflow).toMatch(/\n\s+ref: \$\{\{ steps\.newest\.outputs\.sha \}\}\n/);
  expect(workflow).toMatch(/\n {4}outputs:\n {6}sha: \$\{\{ steps\.newest\.outputs\.sha \}\}\n/);
  // The step the gates read, with the token and the permission its two gh calls need.
  expect(workflow).toMatch(
    /- name: Main's newest commit passed check\n {8}id: newest\n {8}env:\n {10}GH_TOKEN: \$\{\{ github\.token \}\}\n/,
  );
  expect(workflow).toMatch(
    /\n {4}permissions:\n {6}contents: read\n(?: +#.*\n)* {6}actions: read\n/,
  );
  expect(workflow).toMatch(
    /\n {2}deploy:\n {4}needs: build\n {4}if: needs\.build\.outputs\.sha != ''\n/,
  );
});

it("the Pages workflow uploads the folder npm run site writes, after check completes on main", () => {
  expect(workflow).toMatch(/\n\s+run: npm run site\n/);
  expect(workflow).toMatch(/\n\s+path: artifacts\/site\n/);
  const site = readFileSync(new URL("../site.mjs", import.meta.url), "utf8");
  expect(site).toContain('from("../artifacts/site")');
  // The name check.yml gives itself, which workflow_run matches.
  const check = readFileSync(new URL("../../.github/workflows/check.yml", import.meta.url), "utf8");
  expect(check).toMatch(/^name: check\n/);
  expect(workflow).toMatch(
    /workflow_run:\n\s+workflows: \[check\]\n\s+types: \[completed\]\n\s+branches: \[main\]\n/,
  );
});
