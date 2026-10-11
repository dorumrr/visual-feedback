import { describe, expect, it } from "vitest";
import { dated, next, offer, refusal, setVersion, top } from "../release.mjs";

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
});
