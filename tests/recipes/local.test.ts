import { spawnSync } from "node:child_process";
import {
  type Dirent,
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
import { ATTACHMENT_TYPES } from "../../src/shared/report";
import { PNG, valid, WEBP } from "../server/sample";
import { recipe, SERVER } from "./doc";

const { doc, block, load, cleanup } = recipe("local.md");

type Route = { POST(request: Request): Promise<Response> };
let route: Route;
let withFiles: Route;
let cwd = "";
let home = "";
const env = process.env.NODE_ENV;

beforeAll(async () => {
  const imports = { "visual-feedback/server": SERVER };
  route = await load<Route>(block("ts"), imports);
  // The same route with its one switch flipped, as a host turns attachments on.
  const off = "const ATTACHMENTS = false;";
  expect(block("ts").split(off).length).toBe(2);
  withFiles = await load<Route>(block("ts").replace(off, "const ATTACHMENTS = true;"), imports);
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

type Report = Record<string, unknown>;

// One image part per screenshot the report lists, in order.
function post(report: Report, ...images: [Uint8Array, string?][]): Request {
  const form = new FormData();
  form.append("report", JSON.stringify(report));
  for (const [i, [image, type = "image/png"]] of images.entries()) {
    form.append(`image${i}`, new Blob([image as Uint8Array<ArrayBuffer>], { type }), "x");
  }
  return new Request("http://localhost/api/feedback", { method: "POST", body: form });
}

const shot = (report: Report) => (report.screenshots as Report[])[0] as Report;
const none = (report: Report): Report => ({ ...report, screenshots: [] });
const two = (report: Report): Report => ({
  ...report,
  screenshots: [shot(report), { ...shot(report), scroll: { x: 0, y: 900 } }],
});
const stored = (id: unknown) =>
  JSON.parse(readFileSync(join(folder(id), "report.json"), "utf8")) as Report;

const folder = (id: unknown) => join(home, ".visual-feedback", String(id));

const TEXT = new TextEncoder().encode("step 1\nstep 2\n");
type File = [bytes: Uint8Array, name: string, type: string];

// A report with one PNG screenshot and the given files, as the widget sends them.
function postFiles(report: Report, ...files: File[]): Request {
  const attachments = files.map(([bytes, name, type]) => ({ name, type, size: bytes.length }));
  const form = new FormData();
  form.append("report", JSON.stringify({ ...report, attachments }));
  form.append("image0", new Blob([PNG as Uint8Array<ArrayBuffer>], { type: "image/png" }), "x");
  for (const [i, [bytes, name, type]] of files.entries()) {
    form.append(`file${i}`, new Blob([bytes as Uint8Array<ArrayBuffer>], { type }), name);
  }
  return new Request("http://localhost/api/feedback", { method: "POST", body: form });
}

// Every file under the test's folder, so a write anywhere else would show.
const everything = () =>
  (readdirSync(home, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(home.length + 1))
    .sort();

it("a report sent through the recipe is read back from disk, with its image", async () => {
  const report = valid();
  const response = await route.POST(post(report, [PNG]));
  expect(response.status).toBe(204);
  expect(stored(report.id)).toEqual({
    ...report,
    screenshots: [{ ...shot(report), image: "screenshot-0.png" }],
  });
  expect(new Uint8Array(readFileSync(join(folder(report.id), "screenshot-0.png")))).toEqual(PNG);
  expect(readdirSync(join(home, ".visual-feedback"))).toEqual([report.id]);
});

it("each screenshot is its own file, numbered in order, named in report.json", async () => {
  const report = two(valid());
  expect((await route.POST(post(report, [PNG], [WEBP, "image/webp"]))).status).toBe(204);
  expect(readdirSync(folder(report.id)).sort()).toEqual([
    "report.json",
    "screenshot-0.png",
    "screenshot-1.webp",
  ]);
  const shots = stored(report.id).screenshots as Report[];
  expect(shots.map((one) => [one.image, (one.scroll as Report).y])).toEqual([
    ["screenshot-0.png", 140],
    ["screenshot-1.webp", 900],
  ]);
  expect(new Uint8Array(readFileSync(join(folder(report.id), "screenshot-1.webp")))).toEqual(WEBP);
});

it("a report with no screenshots stores report.json alone", async () => {
  const report = none(valid());
  expect((await route.POST(post(report))).status).toBe(204);
  expect(readdirSync(folder(report.id))).toEqual(["report.json"]);
  expect(stored(report.id).screenshots).toEqual([]);
});

it("sending the same report again writes over its folder, never a second one", async () => {
  const report = valid();
  await route.POST(post(report, [PNG]));
  expect((await route.POST(post({ ...report, note: "second try" }, [PNG]))).status).toBe(204);
  expect(readdirSync(join(home, ".visual-feedback"))).toEqual([report.id]);
  expect(stored(report.id).note).toBe("second try");
});

it("sending again with other images, fewer, or none, leaves no image the report does not name", async () => {
  const report = two(valid());
  await route.POST(post(report, [PNG], [PNG]));
  expect((await route.POST(post(valid(), [WEBP, "image/webp"]))).status).toBe(204);
  expect(readdirSync(folder(report.id)).sort()).toEqual(["report.json", "screenshot-0.webp"]);
  expect((await route.POST(post(none(report)))).status).toBe(204);
  expect(readdirSync(folder(report.id))).toEqual(["report.json"]);
});

it("when the image cannot be written, no report.json is left without it", async () => {
  const report = valid();
  // A folder where the image file goes makes its write fail.
  mkdirSync(join(folder(report.id), "screenshot-0.png"), { recursive: true });
  await expect(route.POST(post(report, [PNG]))).rejects.toMatchObject({ code: "EISDIR" });
  expect(existsSync(join(folder(report.id), "report.json"))).toBe(false);
});

it("a request the parser refuses gets its status, and nothing is written", async () => {
  const spoofed = new TextEncoder().encode("<svg/>");
  const response = await route.POST(post(valid(), [spoofed]));
  expect(response.status).toBe(400);
  expect(existsSync(join(home, ".visual-feedback"))).toBe(false);
});

it("with NODE_ENV production, unset or misspelled, it refuses and writes nothing", async () => {
  for (const value of ["production", undefined, "Production", "staging"]) {
    if (value === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = value;
    const response = await route.POST(post(valid(), [PNG]));
    expect(response.status, String(value)).toBe(503);
    expect(existsSync(join(home, ".visual-feedback")), String(value)).toBe(false);
  }
  // The control: the same request in development does write.
  process.env.NODE_ENV = "development";
  expect((await route.POST(post(valid(), [PNG]))).status).toBe(204);
  expect(existsSync(join(home, ".visual-feedback"))).toBe(true);
});

it("the recipe's .gitignore line keeps every stored file out of git", async () => {
  // No global excludes file, so only the recipe's line can ignore anything.
  const git = (...args: string[]) =>
    spawnSync("git", ["-c", "core.excludesFile=", ...args], { cwd: home, encoding: "utf8" });
  expect(git("init", "-q").status).toBe(0);
  const report = valid();
  expect((await route.POST(post(report, [PNG]))).status).toBe(204);
  const files = [
    `.visual-feedback/${report.id}/report.json`,
    `.visual-feedback/${report.id}/screenshot-0.png`,
  ];
  // The control: without the line, git would track both files.
  for (const path of files) expect(git("check-ignore", "-q", path).status, path).toBe(1);
  writeFileSync(join(home, ".gitignore"), block("gitignore"));
  for (const path of files) expect(git("check-ignore", "-q", path).status, path).toBe(0);
});

it("the widget's endpoint in the recipe is the path its route file serves", () => {
  expect(doc).toContain('createFeedback({ endpoint: "/api/feedback" })');
  expect(block("ts")).toMatch(/^\/\/ app\/api\/feedback\/route\.ts$/m);
});

it("the recipe names the files it writes, and how to run it outside Next.js", () => {
  expect(doc).toContain("`screenshot-0.png` or `screenshot-0.webp`");
  expect(doc).toContain("start any other server with `NODE_ENV=development`");
});

it("the recipe says it does not work on a read-only or wiped disk", () => {
  expect(doc).toMatch(/does not work on hosts whose disk is read-only or wiped/);
});

it("with ATTACHMENTS false, as the recipe ships, a report with files is refused and nothing is written", async () => {
  const response = await route.POST(postFiles(valid(), [PNG, "bill.png", "image/png"]));
  expect(response.status).toBe(400);
  expect(existsSync(join(home, ".visual-feedback"))).toBe(false);
  // The control: the same files go through once the switch is on.
  expect((await withFiles.POST(postFiles(valid(), [PNG, "bill.png", "image/png"]))).status).toBe(
    204,
  );
});

it("with ATTACHMENTS true, each file is stored by its place and ending, and read back", async () => {
  const report = valid();
  const files: File[] = [
    [PNG, "Bill 12.PNG", "image/png"],
    [TEXT, "steps.log", "text/plain"],
    [TEXT, "notes.txt", "text/plain"],
  ];
  expect((await withFiles.POST(postFiles(report, ...files))).status).toBe(204);
  expect(readdirSync(folder(report.id)).sort()).toEqual([
    "file-0.png",
    "file-1.log",
    "file-2.txt",
    "report.json",
    "screenshot-0.png",
  ]);
  expect(stored(report.id).attachments).toEqual([
    { name: "Bill 12.PNG", type: "image/png", size: PNG.length, file: "file-0.png" },
    { name: "steps.log", type: "text/plain", size: TEXT.length, file: "file-1.log" },
    { name: "notes.txt", type: "text/plain", size: TEXT.length, file: "file-2.txt" },
  ]);
  expect(new Uint8Array(readFileSync(join(folder(report.id), "file-0.png")))).toEqual(PNG);
  expect(new Uint8Array(readFileSync(join(folder(report.id), "file-1.log")))).toEqual(TEXT);
});

it("every ending the server allows is stored lower-cased, as file-0 with that ending", async () => {
  const text = new TextEncoder().encode("{}\n");
  const bytes: Record<string, Uint8Array> = {
    "image/png": PNG,
    "image/webp": WEBP,
    "image/jpeg": Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1),
    "image/gif": new TextEncoder().encode("GIF89a\x01\x00\x01\x00"),
    "application/pdf": new TextEncoder().encode("%PDF-1.4\n"),
  };
  const report = valid();
  const endings = Object.entries(ATTACHMENT_TYPES).flatMap(([type, list]) =>
    list.map((ending) => [type, ending] as const),
  );
  expect(endings.length).toBe(11);
  for (const [type, ending] of endings) {
    const name = `Upload${ending.toUpperCase()}`;
    const response = await withFiles.POST(postFiles(report, [bytes[type] ?? text, name, type]));
    expect(response.status, name).toBe(204);
    expect(readdirSync(folder(report.id)), name).toContain(`file-0${ending}`);
    expect((stored(report.id).attachments as Report[])[0]?.file, name).toBe(`file-0${ending}`);
  }
});

it("a hostile file name never becomes a path: it is refused, or stored under the recipe's own name", async () => {
  const report = valid();
  for (const name of [
    "../escape.png",
    "../../.visual-feedback/x.png",
    "a/b.png",
    "..\\up.png",
    "..",
  ]) {
    const response = await withFiles.POST(postFiles(report, [PNG, name, "image/png"]));
    expect(response.status, name).toBe(400);
    expect(everything(), name).toEqual([]);
  }
  const odd = ["..png", ".png.png", "report.json.png", "screenshot-0.png"];
  const files = odd.map((name): File => [PNG, name, "image/png"]);
  expect((await withFiles.POST(postFiles(report, ...files))).status).toBe(204);
  const at = (file: string) => `.visual-feedback/${report.id}/${file}`;
  expect(everything()).toEqual(
    ["file-0.png", "file-1.png", "file-2.png", "file-3.png", "report.json", "screenshot-0.png"].map(
      at,
    ),
  );
  expect((stored(report.id).attachments as Report[]).map((entry) => entry.name)).toEqual(odd);
});

it("sending again with fewer files, or none, leaves no file the report does not name", async () => {
  const report = valid();
  const two: File[] = [
    [PNG, "a.png", "image/png"],
    [TEXT, "b.log", "text/plain"],
  ];
  expect((await withFiles.POST(postFiles(report, ...two))).status).toBe(204);
  expect(readdirSync(folder(report.id)).sort()).toEqual([
    "file-0.png",
    "file-1.log",
    "report.json",
    "screenshot-0.png",
  ]);
  expect((await withFiles.POST(postFiles(report, [TEXT, "c.txt", "text/plain"]))).status).toBe(204);
  expect(readdirSync(folder(report.id)).sort()).toEqual([
    "file-0.txt",
    "report.json",
    "screenshot-0.png",
  ]);
  expect((await withFiles.POST(post(report, [PNG]))).status).toBe(204);
  expect(readdirSync(folder(report.id)).sort()).toEqual(["report.json", "screenshot-0.png"]);
  expect(Object.hasOwn(stored(report.id), "attachments")).toBe(false);
});

it("a report with no files writes exactly the same files and report.json with ATTACHMENTS true or false", async () => {
  const report = two(valid());
  const written = async (one: Route) => {
    expect((await one.POST(post(report, [PNG], [WEBP, "image/webp"]))).status).toBe(204);
    const names = readdirSync(folder(report.id)).sort();
    const json = readFileSync(join(folder(report.id), "report.json"), "utf8");
    rmSync(join(home, ".visual-feedback"), { recursive: true });
    return { names, json };
  };
  const off = await written(route);
  expect(off.names).toEqual(["report.json", "screenshot-0.png", "screenshot-1.webp"]);
  expect(await written(withFiles)).toEqual(off);
});

it("the recipe says attachments are off, and to turn them on only with the widget's option", () => {
  expect(doc).toContain("only together with the widget's `attachments` option");
  expect(doc).toContain("`file-0.png`, `file-1.log`");
  expect(block("ts")).toContain("parseFeedbackRequest(request, { attachments: ATTACHMENTS })");
});
