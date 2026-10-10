import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { PNG, valid, WEBP } from "../server/sample";
import { recipe, SERVER } from "./doc";

const { doc, block, load, cleanup } = recipe("local.md");

type Route = { POST(request: Request): Promise<Response> };
let route: Route;
let cwd = "";
let home = "";
const env = process.env.NODE_ENV;

beforeAll(async () => {
  route = await load<Route>(block("ts"), { "visual-feedback/server": SERVER });
});

afterAll(cleanup);

beforeEach(() => {
  cwd = process.cwd();
  home = mkdtempSync(join(tmpdir(), "vf-local-"));
  process.chdir(home);
  process.env.NODE_ENV = "development";
});

afterEach(() => {
  process.chdir(cwd);
  if (env === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = env;
  rmSync(home, { recursive: true, force: true });
});

function post(report: Record<string, unknown>, image?: Uint8Array, type = "image/png"): Request {
  const form = new FormData();
  form.append("report", JSON.stringify(report));
  if (image) form.append("image", new Blob([image as Uint8Array<ArrayBuffer>], { type }), "x");
  return new Request("http://localhost/api/feedback", { method: "POST", body: form });
}

const folder = (id: unknown) => join(home, ".visual-feedback", String(id));

it("a report sent through the recipe is read back from disk, with its image", async () => {
  const report = valid();
  const response = await route.POST(post(report, PNG));
  expect(response.status).toBe(204);
  const stored = JSON.parse(readFileSync(join(folder(report.id), "report.json"), "utf8"));
  expect(stored).toEqual({ ...report, image: "image.png" });
  expect(new Uint8Array(readFileSync(join(folder(report.id), "image.png")))).toEqual(PNG);
  expect(readdirSync(join(home, ".visual-feedback"))).toEqual([report.id]);
});

it("a report with no image stores report.json alone, with image: null", async () => {
  const report: Record<string, unknown> = { ...valid(), marks: [] };
  expect((await route.POST(post(report))).status).toBe(204);
  expect(readdirSync(folder(report.id))).toEqual(["report.json"]);
  expect(JSON.parse(readFileSync(join(folder(report.id), "report.json"), "utf8")).image).toBeNull();
});

it("sending the same report again writes over its folder, never a second one", async () => {
  const report = valid();
  await route.POST(post(report, PNG));
  expect((await route.POST(post({ ...report, note: "second try" }, PNG))).status).toBe(204);
  expect(readdirSync(join(home, ".visual-feedback"))).toEqual([report.id]);
  expect(JSON.parse(readFileSync(join(folder(report.id), "report.json"), "utf8")).note).toBe(
    "second try",
  );
});

it("sending again with another image, or none, leaves no image the report does not name", async () => {
  const report = valid();
  await route.POST(post(report, PNG));
  expect((await route.POST(post(report, WEBP, "image/webp"))).status).toBe(204);
  expect(readdirSync(folder(report.id)).sort()).toEqual(["image.webp", "report.json"]);
  expect((await route.POST(post({ ...report, marks: [] }))).status).toBe(204);
  expect(readdirSync(folder(report.id))).toEqual(["report.json"]);
});

it("when the image cannot be written, no report.json is left without it", async () => {
  const report = valid();
  // A folder where the image file goes makes its write fail.
  mkdirSync(join(folder(report.id), "image.png"), { recursive: true });
  await expect(route.POST(post(report, PNG))).rejects.toMatchObject({ code: "EISDIR" });
  expect(existsSync(join(folder(report.id), "report.json"))).toBe(false);
});

it("a request the parser refuses gets its status, and nothing is written", async () => {
  const spoofed = new TextEncoder().encode("<svg/>");
  const response = await route.POST(post(valid(), spoofed));
  expect(response.status).toBe(400);
  expect(existsSync(join(home, ".visual-feedback"))).toBe(false);
});

it("with NODE_ENV production, unset or misspelled, it refuses and writes nothing", async () => {
  for (const value of ["production", undefined, "Production", "staging"]) {
    if (value === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = value;
    const response = await route.POST(post(valid(), PNG));
    expect(response.status, String(value)).toBe(503);
    expect(existsSync(join(home, ".visual-feedback")), String(value)).toBe(false);
  }
  // The control: the same request in development does write.
  process.env.NODE_ENV = "development";
  expect((await route.POST(post(valid(), PNG))).status).toBe(204);
  expect(existsSync(join(home, ".visual-feedback"))).toBe(true);
});

it("the recipe's .gitignore line keeps every stored file out of git", async () => {
  // No global excludes file, so only the recipe's line can ignore anything.
  const git = (...args: string[]) =>
    spawnSync("git", ["-c", "core.excludesFile=", ...args], { cwd: home, encoding: "utf8" });
  expect(git("init", "-q").status).toBe(0);
  const report = valid();
  expect((await route.POST(post(report, PNG))).status).toBe(204);
  const stored = [
    `.visual-feedback/${report.id}/report.json`,
    `.visual-feedback/${report.id}/image.png`,
  ];
  // The control: without the line, git would track both files.
  for (const path of stored) expect(git("check-ignore", "-q", path).status, path).toBe(1);
  writeFileSync(join(home, ".gitignore"), block("gitignore"));
  for (const path of stored) expect(git("check-ignore", "-q", path).status, path).toBe(0);
});

it("the widget's endpoint in the recipe is the path its route file serves", () => {
  expect(doc).toContain('createFeedback({ endpoint: "/api/feedback" })');
  expect(block("ts")).toMatch(/^\/\/ app\/api\/feedback\/route\.ts$/m);
});

it("the recipe names the files it writes, and how to run it outside Next.js", () => {
  expect(doc).toContain("`image.png` or `image.webp`");
  expect(doc).toContain("start any other server with `NODE_ENV=development`");
});

it("the recipe says it does not work on a read-only or wiped disk", () => {
  expect(doc).toMatch(/does not work on hosts whose disk is read-only or wiped/);
});
