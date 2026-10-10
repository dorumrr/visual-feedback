import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { PNG, valid } from "../server/sample";
import { markdown, SERVER } from "./doc";

const { doc, block, load, cleanup } = markdown("README.md");

afterAll(cleanup);

type Route = { POST(request: Request): Promise<Response> };

it("the README's install line names this package", () => {
  const { name } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  expect(block("sh").trim()).toBe(`npm install ${name}`);
});

it("the README's server route, as written, takes a report and refuses a bad one", async () => {
  const route = await load<Route>(block("ts"), { "visual-feedback/server": SERVER });
  const post = (image: Uint8Array) => {
    const form = new FormData();
    form.append("report", JSON.stringify(valid()));
    form.append("image", new Blob([image as Uint8Array<ArrayBuffer>], { type: "image/png" }), "x");
    return new Request("http://localhost/api/feedback", { method: "POST", body: form });
  };
  expect((await route.POST(post(PNG))).status).toBe(204);
  expect((await route.POST(post(new TextEncoder().encode("<svg/>")))).status).toBe(400);
});

it("the README's demo image is in the repo and under 1 MB", () => {
  const path = /!\[[^\]]+\]\(([^)]+)\)/.exec(doc)?.[1] ?? "";
  expect(path).toBe("docs/demo.png");
  const bytes = readFileSync(new URL(`../../${path}`, import.meta.url));
  expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  // The width and height tests/demo.mjs shoots at, from the PNG header, and a whole file.
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1280, 800]);
  expect(bytes.subarray(-8, -4).toString("latin1")).toBe("IEND");
  expect(bytes.length).toBeGreaterThan(10_000);
  expect(bytes.length).toBeLessThan(1_000_000);
});

it("every code block in the README is one a test runs", () => {
  // Every fence line, indented or with ~~~ or extra words too; every second one opens a block.
  const fences = [...doc.matchAll(/^[ \t]*(?:```|~~~)(.*)$/gm)].map((match) => match[1]?.trim());
  expect(fences).toHaveLength(8);
  expect(fences.filter((_, index) => index % 2 === 0).sort()).toEqual(["js", "sh", "ts", "tsx"]);
});

it("the CHANGELOG has an entry for the version the package will publish", () => {
  const changelog = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
  expect(changelog).toMatch(/^## 0\.1\.0 /m);
  expect(changelog.split("\n").filter((line) => line.startsWith("- ")).length).toBeGreaterThan(3);
});

it("package.json has every field the npm page needs", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  for (const field of [
    "description",
    "keywords",
    "license",
    "author",
    "repository",
    "homepage",
    "bugs",
    "type",
    "exports",
    "types",
    "files",
    "sideEffects",
    "engines",
  ]) {
    expect(pkg[field], field).not.toBeUndefined();
  }
  expect(pkg.sideEffects).toBe(false);
  expect(pkg.peerDependenciesMeta?.react?.optional).toBe(true);
  expect(pkg.peerDependencies?.react).toBe(">=18");
  expect(pkg.private).toBeUndefined();
  expect(pkg.license).toBe("MIT");
  expect(pkg.description.length).toBeGreaterThan(40);
  expect(pkg.keywords.length).toBeGreaterThan(2);
  expect(pkg.author).toBeTruthy();
  expect(pkg.files.length).toBeGreaterThan(5);
  expect(pkg.repository.url).toBe("git+https://github.com/dorumrr/visual-feedback.git");
  // The README points to the same public repo.
  expect(doc).toContain("(https://github.com/dorumrr/visual-feedback)");
  expect(pkg.homepage).toBe("https://github.com/dorumrr/visual-feedback#readme");
  expect(pkg.bugs).toBe("https://github.com/dorumrr/visual-feedback/issues");
});
