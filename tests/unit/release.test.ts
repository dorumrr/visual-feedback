import { describe, expect, it } from "vitest";
import { dated, next, setVersion } from "../release.mjs";

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
    expect(() => dated(log, "0.4.0", "2026-11-01")).toThrow(/## 0\.4\.0/);
    // The dots are literal: 0x3y0 is not 0.3.0.
    expect(() => dated("# Changelog\n\n## 0x3y0\n", "0.3.0", "2026-11-01")).toThrow();
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
