import { describe, expect, it } from "vitest";
import { dated, finish, next, offer, refusal, release, setVersion, top } from "../release.mjs";

type Output = { ok: boolean; out: string };

/**
 * Runs the release on a fake terminal that gives `answers` in turn, fake commands and an in-memory
 * repo: main is clean and level with origin, npm has 0.3.2 and CHANGELOG.md waits on 0.3.3, unless
 * `outputs` says otherwise. Returns how it ended, and every question, command and write in order.
 */
async function rehearse(
  answers: string[],
  outputs: Record<string, Output> = {},
  stored: Record<string, string> = {},
) {
  const log: string[] = [];
  const known: Record<string, Output> = {
    "git branch --show-current": { ok: true, out: "main" },
    "git rev-list --count HEAD..origin/main": { ok: true, out: "0" },
    "npm view visual-feedback version": { ok: true, out: "0.3.2" },
  };
  const files: Record<string, string> = {
    "package.json": '{\n  "name": "visual-feedback",\n  "version": "0.3.2"\n}\n',
    "package-lock.json": '{\n  "name": "visual-feedback",\n  "version": "0.3.2"\n}\n',
    "CHANGELOG.md":
      "# Changelog\n\n## 0.3.3 (not released yet)\n\n- x\n\n## 0.3.2 (2026-10-13)\n\n- y\n",
  };
  let asked = 0;
  const written: Record<string, string> = {};
  const result = await release({
    ask: async (question: string) => {
      log.push(`ask ${question}`);
      const answer = answers[asked++];
      if (answer === undefined) throw new Error(`unexpected question: ${question}`);
      return answer;
    },
    run: (command: string, args: string[]) => {
      const call = `${command} ${args.join(" ")}`;
      log.push(`run ${call}`);
      // Read at each call, so an output can change between two of them.
      return (call in outputs ? outputs[call] : known[call]) ?? { ok: true, out: "" };
    },
    sleep: async () => {},
    // Read at each call, so a file can change between two reads.
    read: (name: string) => (name in stored ? stored[name] : files[name]) ?? "",
    write: (name: string, text: string) => {
      log.push(`write ${name}`);
      written[name] = text;
    },
  }).then(
    () => "done",
    (error: Error) => error.message,
  );
  return { result, log, written, at: (entry: string) => log.indexOf(entry) };
}

const CHECK = "run npm run check";
const QUESTION = "ask Run the full check first, npm run check (a few minutes)? [y/N] ";

describe("npm run release", () => {
  it("suggests the package version while npm lacks it, else the next patch", () => {
    expect(next("0.2.0", "0.1.0")).toBe("0.2.0");
    expect(next("0.2.0", "0.2.0")).toBe("0.2.1");
    expect(next("0.2.9", "0.2.9")).toBe("0.2.10");
    expect(next("1.0.0", undefined)).toBe("1.0.0");
  });

  it("dates a heading that is not released yet, keeps a dated one, and refuses a missing one", () => {
    const log = "# Changelog\n\n## 0.3.0 (not released yet)\n\n- x\n\n## 0.2.0 (2026-10-10)\n";
    expect(dated(log, "0.3.0", "2026-11-01")).toBe(
      log.replace("(not released yet)", "(2026-11-01)"),
    );
    expect(dated(log, "0.2.0", "2026-11-01")).toBe(log);
    // Every wording the publish workflow refuses is dated, and a CRLF file keeps its line ends.
    for (const note of ["(unreleased)", "(Not Released)", "(not yet released)"]) {
      expect(dated(log.replace("(not released yet)", note), "0.3.0", "2026-11-01"), note).toBe(
        log.replace("(not released yet)", "(2026-11-01)"),
      );
    }
    const crlf = log.replaceAll("\n", "\r\n");
    expect(dated(crlf, "0.3.0", "2026-11-01")).toBe(
      crlf.replace("(not released yet)", "(2026-11-01)"),
    );
    // Only the heading of that version changes, not the same words elsewhere.
    const words = "# Changelog\n\nnot released yet\n\n## 0.3.0 (not released yet)\n\n- x\n";
    expect(dated(words, "0.3.0", "2026-11-01")).toBe(
      words.replace("## 0.3.0 (not released yet)", "## 0.3.0 (2026-11-01)"),
    );
    expect(() => dated(log, "0.4.0", "2026-11-01")).toThrow(/## 0\.4\.0/);
    // The dots are literal: 0x3y0 is not 0.3.0.
    expect(() => dated("# Changelog\n\n## 0x3y0\n", "0.3.0", "2026-11-01")).toThrow();
  });

  const LOG = `# Changelog

## 0.3.0 (not released yet)

- Breaking: a change.
- A fix.

## 0.2.0 (2026-10-10)

- x
`;

  it("reads the newest entry: its version, whether it waits for a date, and its lines", () => {
    expect(top(LOG)).toEqual({
      version: "0.3.0",
      waiting: true,
      text: "\n\n- Breaking: a change.\n- A fix.\n\n",
    });
    expect(top(LOG.replace("(not released yet)", "(2026-11-01)"))?.waiting).toBe(false);
    // The same words, in any case, as the publish workflow's check.
    for (const note of ["(Not Released)", "(unreleased)", "(not yet released)"]) {
      expect(top(LOG.replace("(not released yet)", note))?.waiting, note).toBe(true);
    }
    expect(top("# Changelog\n")).toBeUndefined();
  });

  it("offers the newest entry's version while it waits to be released, else the next patch", () => {
    expect(offer("0.2.0", "0.2.0", LOG)).toBe("0.3.0");
    expect(offer("0.2.0", undefined, LOG)).toBe("0.3.0");
    const released = LOG.replace("(not released yet)", "(2026-11-01)");
    expect(offer("0.3.0", "0.3.0", released)).toBe("0.3.1");
  });

  it("refuses, before anything is written, a version that is not the entry waiting", () => {
    expect(refusal(LOG, "0.3.0")).toBeUndefined();
    expect(refusal(LOG, "0.2.1")).toMatch(
      /newest entry, "## 0\.3\.0", waits to be released, not 0\.2\.1/,
    );
    const released = LOG.replace("(not released yet)", "(2026-11-01)");
    expect(refusal(released, "0.3.1")).toMatch(
      /newest entry is "## 0\.3\.0", already dated: write a "## 0\.3\.1 \(not released yet\)" entry/,
    );
    // A dated entry releases again, as after a publish that failed.
    expect(refusal(released, "0.3.0")).toBeUndefined();
    expect(refusal("# Changelog\n", "0.3.0")).toMatch(/no "## 0\.3\.0" entry/);
  });

  it("refuses an entry with no change listed", () => {
    const empty = "# Changelog\n\n## 0.3.0 (not released yet)\n\n## 0.2.0 (2026-10-10)\n\n- x\n";
    expect(refusal(empty, "0.3.0")).toMatch(/lists no change/);
  });

  it("refuses a Breaking: change shipped as a patch: a new minor before 1.0, a new major from 1.0", () => {
    // Measured from the entry below, whatever package.json or npm say.
    const patch = LOG.replaceAll("0.3.0", "0.2.1");
    expect(refusal(patch, "0.2.1")).toMatch(/Breaking: .* new minor version, 0\.3\.0/);
    const one = LOG.replaceAll("0.3.0", "1.1.0").replace("0.2.0 (", "1.0.0 (");
    expect(refusal(one, "1.1.0")).toMatch(/Breaking: .* new major version, 2\.0\.0/);
    expect(refusal(one.replaceAll("1.1.0", "1.0.1"), "1.0.1")).toMatch(
      /new major version, 2\.0\.0/,
    );
    expect(refusal(one.replaceAll("1.1.0", "2.0.0"), "2.0.0")).toBeUndefined();
    // From 0.x, 1.0.0 is a new major: allowed.
    expect(refusal(LOG.replaceAll("0.3.0", "1.0.0"), "1.0.0")).toBeUndefined();
    // Without a Breaking: line a patch is fine.
    expect(refusal(patch.replace("- Breaking: a change.\n", ""), "0.2.1")).toBeUndefined();
    // Breaking: within a line, in bold or in capitals counts too; "non-breaking:" does not.
    for (const line of [
      "- A fix. Breaking: Esc keeps it.",
      "- **Breaking:** x",
      "- BREAKING: x",
      "  - Breaking: x",
    ]) {
      const log = patch.replace("- Breaking: a change.", line);
      expect(refusal(log, "0.2.1"), line).toMatch(/new minor version/);
    }
    expect(
      refusal(patch.replace("- Breaking: a change.", "- A non-breaking: tweak."), "0.2.1"),
    ).toBeUndefined();
    // Only the entry being released counts, and versions compare as numbers.
    const older =
      "# Changelog\n\n## 0.2.1 (not released yet)\n\n- A fix.\n\n## 0.2.0 (2026-10-10)\n\n- Breaking: old.\n";
    expect(refusal(older, "0.2.1")).toBeUndefined();
    const tens =
      "# Changelog\n\n## 0.10.0 (not released yet)\n\n- Breaking: x\n\n## 0.9.0 (2026-01-01)\n\n- y\n";
    expect(refusal(tens, "0.10.0")).toBeUndefined();
    expect(refusal(tens.replaceAll("0.10.0", "0.9.1"), "0.9.1")).toMatch(
      /new minor version, 0\.10\.0/,
    );
  });

  it("refuses a heading the publish workflow would refuse, and an entry that is not the newest", () => {
    expect(refusal(LOG.replace("## 0.3.0 (not", "## 0.3.0(not"), "0.3.0")).toMatch(
      /exactly one "## 0\.3\.0" heading.*it has 0/,
    );
    expect(refusal(LOG.replace("## 0.3.0 (not", "## 0.3.0\t(not"), "0.3.0")).toMatch(/it has 0/);
    expect(refusal(`${LOG}\n## 0.3.0\n\n- y\n`, "0.3.0")).toMatch(/it has 2/);
    expect(refusal(LOG, "0.2.0")).toMatch(
      /"## 0\.2\.0" entry is not the newest one: move it above "## 0\.3\.0"/,
    );
    // The workflow's grep reads a CR as part of the line.
    const crlf = LOG.replace("## 0.3.0 (not released yet)", "## 0.3.0").replaceAll("\n", "\r\n");
    expect(refusal(crlf, "0.3.0")).toMatch(/it has 0/);
    expect(refusal(LOG.replaceAll("\n", "\r\n"), "0.3.0")).toBeUndefined();
    // A heading with no version is not offered.
    expect(offer("0.2.0", "0.2.0", "# Changelog\n\n## Unreleased\n\n- x\n")).toBe("0.2.1");
  });

  it("sets the version in package.json and both places of package-lock.json, keeping the format", () => {
    const pkg = '{\n  "name": "visual-feedback",\n  "version": "0.2.0",\n  "type": "module"\n}\n';
    const lock =
      '{\n  "name": "visual-feedback",\n  "version": "0.2.0",\n  "lockfileVersion": 3,\n  "packages": {\n    "": {\n      "name": "visual-feedback",\n      "version": "0.2.0"\n    },\n    "node_modules/x": {\n      "version": "0.2.0"\n    }\n  }\n}\n';
    expect(setVersion(pkg, "0.3.0")).toBe(pkg.replace("0.2.0", "0.3.0"));
    const changed = JSON.parse(setVersion(lock, "0.3.0"));
    expect([changed.version, changed.packages[""].version]).toEqual(["0.3.0", "0.3.0"]);
    // A dependency of the same version is not touched.
    expect(changed.packages["node_modules/x"].version).toBe("0.2.0");
    expect(setVersion(lock, "0.3.0").endsWith("}\n")).toBe(true);
  });

  it("asks first whether to run the full check, and Enter skips it", async () => {
    const { log } = await rehearse(["", "0.3.3", "y"]);
    expect(log.find((entry) => entry.startsWith("ask "))).toBe(QUESTION);
    expect(log).toContain("write CHANGELOG.md");
    expect(log).not.toContain(CHECK);
  });

  it("asks every question before the check, the first write and the first push", async () => {
    const { log, at } = await rehearse(["y", "y", "0.3.3", "y"], {
      "git log --oneline origin/main..HEAD": { ok: true, out: "abc x" },
    });
    const asked = log.flatMap((entry, i) => (entry.startsWith("ask ") ? [i] : []));
    expect(asked).toHaveLength(4);
    const first = Math.min(
      at(CHECK),
      ...log.flatMap((entry, i) => (entry.startsWith("write") ? [i] : [])),
      at("run git push origin main"),
    );
    expect(Math.max(...asked)).toBeLessThan(first);
    expect(at(CHECK)).toBeGreaterThan(-1);
  });

  it("y runs npm run check once the version passed every refusal, before the first write", async () => {
    const { at, log, written } = await rehearse(["y", "0.3.3", "y"]);
    expect(JSON.parse(written["package.json"] ?? "").version).toBe("0.3.3");
    expect(JSON.parse(written["package-lock.json"] ?? "").version).toBe("0.3.3");
    expect(written["CHANGELOG.md"]).toMatch(/^## 0\.3\.3 \(\d{4}-\d{2}-\d{2}\)$/m);
    expect(at(CHECK)).toBeGreaterThan(at("ask Version to publish: "));
    const writes = log.flatMap((entry, i) => (entry.startsWith("write") ? [i] : []));
    expect(writes).toHaveLength(3);
    expect(at(CHECK)).toBeLessThan(Math.min(...writes));
  });

  it("tags the pushed commit only once the publish run passed", async () => {
    const outputs = (watched: boolean): Record<string, Output> => ({
      "git rev-parse HEAD": { ok: true, out: "abc1234def" },
      "gh run list --workflow publish.yml --event workflow_dispatch --limit 5 --json databaseId,createdAt,url":
        {
          ok: true,
          out: JSON.stringify([{ databaseId: 7, createdAt: new Date().toISOString(), url: "u" }]),
        },
      "gh run watch 7 --exit-status --interval 5": { ok: watched, out: "" },
      "npm view visual-feedback@0.3.3 version": { ok: true, out: "0.3.3" },
    });
    const tag = "run git tag v0.3.3 abc1234def";
    const passed = await rehearse(["", "0.3.3", "y"], outputs(true));
    expect(passed.result).toBe("done");
    expect(passed.at(tag)).toBeGreaterThan(
      passed.at("run gh run watch 7 --exit-status --interval 5"),
    );
    expect(passed.log).toContain("run git push origin v0.3.3");
    const failed = await rehearse(["", "0.3.3", "y"], outputs(false));
    expect(failed.result).toMatch(/The publish run failed/);
    expect(failed.log.some((entry) => entry.startsWith("run git tag"))).toBe(false);
  });

  it("after the check, main is compared with origin again: it may have moved meanwhile", async () => {
    const fetch = "run git fetch --quiet origin main";
    const skipped = await rehearse(["", "0.3.3", "n"]);
    expect(skipped.log.filter((entry) => entry === fetch)).toHaveLength(1);
    let behind = 0;
    const moved = await rehearse(["y", "0.3.3", "y"], {
      get "git rev-list --count HEAD..origin/main"() {
        behind++;
        return { ok: true, out: behind === 1 ? "0" : "1" };
      },
    });
    expect(moved.result).toBe("main is behind origin/main: pull first.");
    expect(moved.at(fetch)).not.toBe(moved.log.lastIndexOf(fetch));
    expect(moved.log.lastIndexOf(fetch)).toBeGreaterThan(moved.at(CHECK));
    expect(moved.log.filter((entry) => entry.startsWith("write"))).toEqual([]);
  });

  it("a failed check stops the release before anything is changed", async () => {
    const { result, log } = await rehearse(["y", "0.3.3", "y"], {
      "npm run check": { ok: false, out: "" },
    });
    expect(log.some((entry) => entry.startsWith("write"))).toBe(false);
    expect(result).toBe(
      "npm run check failed: nothing was changed, committed, pushed or published.",
    );
    expect(log.at(-1)).toBe(CHECK);
  });

  it("a release that cannot happen runs no check", async () => {
    const refusals: [Record<string, Output>, string[], RegExp | string][] = [
      [{ "git branch --show-current": { ok: true, out: "other" } }, ["y"], /Run it on main/],
      [{ "git status --porcelain": { ok: true, out: " M x" } }, ["y"], /Commit or stash/],
      [{ "git rev-list --count HEAD..origin/main": { ok: true, out: "2" } }, ["y"], /behind/],
      [{ "git log --oneline origin/main..HEAD": { ok: true, out: "abc x" } }, ["y", ""], "done"],
      [{}, ["y", "0.3.x"], /is not a version/],
      [{}, ["y", "0.3.2"], /not newer than 0.3.2/],
      [{}, ["y", "0.4.0"], /CHANGELOG.md/],
    ];
    for (const [outputs, answers, expected] of refusals) {
      const { result, log } = await rehearse(answers, outputs);
      // Declining unpushed commits ends it there, at that question.
      if (expected === "done") {
        expect(log.at(-1)).toBe("ask Release them too? [y/N] ");
        expect(log.some((entry) => entry.startsWith("write"))).toBe(false);
      }
      expect(result, String(expected)).toMatch(expected);
      expect(log, String(expected)).not.toContain(CHECK);
    }
  });

  it("the check question takes y or Y as yes, and anything else as no", async () => {
    for (const [answer, runs] of [
      ["Y", true],
      ["n", false],
      ["N", false],
      ["yes", false],
    ] as const) {
      const { log } = await rehearse([answer, "0.3.3", "y"]);
      expect(log.includes(CHECK), answer).toBe(runs);
    }
  });

  it("the publish question shows Y/n: Enter, y or Y go ahead, anything else stops with nothing written or run", async () => {
    const push = "run git push origin main";
    const commit =
      "run git commit --quiet -m Release 0.3.3 -- CHANGELOG.md package.json package-lock.json";
    // Already at 0.3.3 and dated: nothing to commit, only to push and publish.
    const released = {
      "package.json": '{\n  "name": "visual-feedback",\n  "version": "0.3.3"\n}\n',
      "package-lock.json": '{\n  "name": "visual-feedback",\n  "version": "0.3.3"\n}\n',
      "CHANGELOG.md":
        "# Changelog\n\n## 0.3.3 (2026-10-14)\n\n- x\n\n## 0.3.2 (2026-10-13)\n\n- y\n",
    };
    for (const wrote of [true, false]) {
      const question = wrote
        ? 'ask Commit "Release 0.3.3", push and publish 0.3.3? [Y/n] '
        : "ask Push and publish 0.3.3? [Y/n] ";
      for (const [answer, goes] of [
        ["", true],
        ["y", true],
        ["Y", true],
        ["n", false],
        ["N", false],
        ["yes", false],
      ] as const) {
        let status = 0;
        const { result, log } = await rehearse(
          ["y", "0.3.3", answer],
          {
            // Clean before the release, then the three files it wrote, unless they held that version.
            get "git status --porcelain"() {
              return { ok: true, out: status++ === 0 || !wrote ? "" : " M CHANGELOG.md" };
            },
          },
          wrote ? {} : released,
        );
        const label = `${wrote} ${answer}`;
        expect(log, label).toContain(question);
        expect(log.includes(push), label).toBe(goes);
        expect(log.includes(commit), label).toBe(wrote && goes);
        expect(log.includes(CHECK), label).toBe(goes);
        expect(
          log.some((entry) => entry.startsWith("write")),
          label,
        ).toBe(wrote && goes);
        expect(
          log.some((entry) => entry.startsWith("run gh ")),
          label,
        ).toBe(goes);
        if (!goes) expect(result, label).toBe("done");
      }
    }
  });

  it("a commit that fails puts the release files back and pushes nothing", async () => {
    const names = "CHANGELOG.md package.json package-lock.json";
    const { result, log, at } = await rehearse(["", "0.3.3", "y"], {
      [`git commit --quiet -m Release 0.3.3 -- ${names}`]: { ok: false, out: "" },
    });
    expect(result).toMatch(/The release files were put back: nothing was pushed\.$/);
    expect(at(`run git checkout -- ${names}`)).toBeGreaterThan(at("write CHANGELOG.md"));
    expect(log).not.toContain("run git push origin main");
  });

  it("a restore that fails says so, with the command to run", async () => {
    const names = "CHANGELOG.md package.json package-lock.json";
    const { result } = await rehearse(["", "0.3.3", "y"], {
      [`git commit --quiet -m Release 0.3.3 -- ${names}`]: { ok: false, out: "" },
      [`git checkout -- ${names}`]: { ok: false, out: "" },
    });
    expect(result).toMatch(
      /failed too: git checkout -- CHANGELOG\.md package\.json package-lock\.json\. Nothing was pushed\.$/,
    );
  });

  it("a release file changed during the check stops it before anything is written", async () => {
    let reads = 0;
    const { result, log } = await rehearse(
      ["y", "0.3.3", "y"],
      {},
      {
        get "package.json"() {
          reads++;
          return `{\n  "name": "visual-feedback",\n  "version": "${reads > 2 ? "9.9.9" : "0.3.2"}"\n}\n`;
        },
      },
    );
    expect(result).toBe("package.json changed during the check: nothing was written or pushed.");
    expect(log.some((entry) => entry.startsWith("write"))).toBe(false);
  });

  it("refuses a branch, a dirty tree or a main behind origin before it asks anything", async () => {
    for (const outputs of [
      { "git branch --show-current": { ok: true, out: "other" } },
      { "git status --porcelain": { ok: true, out: " M x" } },
      { "git rev-list --count HEAD..origin/main": { ok: true, out: "2" } },
    ]) {
      const { log } = await rehearse([], outputs);
      expect(log.some((entry) => entry.startsWith("ask "))).toBe(false);
    }
  });

  it("once the publish run passed, it tags the published commit and pushes the tag, asking nothing", async () => {
    const finished = async (failing: string | undefined, listed: boolean) => {
      const calls: string[] = [];
      let waits = 0;
      const result = await finish(
        {
          run: (command: string, args: string[]) => {
            const call = `${command} ${args.join(" ")}`;
            calls.push(call);
            if (call === failing) return { ok: false, out: "" };
            return { ok: true, out: call.startsWith("npm view") && listed ? "0.4.0" : "" };
          },
          sleep: async () => {
            waits++;
          },
        },
        "0.4.0",
        "abc1234def",
      ).then(
        () => "done",
        (error: Error) => error.message,
      );
      return { result, calls, waits };
    };
    for (const listed of [true, false]) {
      const { result, calls, waits } = await finished(undefined, listed);
      // The tag comes first, also when npm does not list the version yet.
      expect(result, String(listed)).toBe("done");
      expect(calls.slice(0, 2), String(listed)).toEqual([
        "git tag v0.4.0 abc1234def",
        "git push origin v0.4.0",
      ]);
      expect(waits, String(listed)).toBe(listed ? 0 : 75);
    }
    // A tag that fails still lets it wait for npm, then says the version is out and what is left.
    for (const failing of ["git tag v0.4.0 abc1234def", "git push origin v0.4.0"]) {
      const { result, calls } = await finished(failing, true);
      expect(calls, failing).toContain("npm view visual-feedback@0.4.0 version");
      expect(result, failing).toBe(
        "0.4.0 is published, but its tag is not on origin: git tag v0.4.0 abc1234def (unless it exists), then git push origin v0.4.0",
      );
    }
  });
});
