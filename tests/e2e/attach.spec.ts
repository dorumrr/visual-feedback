import { existsSync, readFileSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { parseFeedbackRequest } from "../../src/server/index";
import { confirmed, events, failable, finish, mount } from "./widget";

const BASELINE = new URL("./attach-baseline.json", import.meta.url);
const note = (page: Page) => page.getByRole("textbox", { name: "Your note" });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** Every part name inside the widget's shadow root, sorted, once each. */
const parts = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector("visual-feedback")?.shadowRoot;
    const names = [...(root?.querySelectorAll("[part]") ?? [])].flatMap((node) =>
      (node.getAttribute("part") ?? "").split(" "),
    );
    return [...new Set(names)].sort();
  });

/** A JSON value with each leaf replaced by its type, so only the shape is compared. */
const shape = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(shape)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)]))
      : typeof value;

/** The endpoint body as part names, each part's headers with the id taken out, and the report's shape. */
async function body(page: Page, key: string) {
  const [kept] = (await (await page.request.get(`/api/feedback/${key}`)).json()) as {
    headers: Record<string, string>;
    body: string;
  }[];
  if (!kept) throw new Error("nothing received");
  const raw = Buffer.from(kept.body, "base64").toString("latin1");
  const boundary = /boundary=(.+)$/.exec(kept.headers["content-type"] ?? "")?.[1] ?? "";
  const sections = raw.split(`--${boundary}`).slice(1, -1);
  return sections.map((section) => {
    const [head = "", ...rest] = section.replace(/^\r\n/, "").split("\r\n\r\n");
    const headers = head.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "ID").split("\r\n");
    const name = /name="([^"]+)"/.exec(head)?.[1];
    const content = rest.join("\r\n\r\n").replace(/\r\n$/, "");
    return { name, headers, ...(name === "report" ? { report: shape(JSON.parse(content)) } : {}) };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/widget/capture.html");
});

test("with attachments off, the dialog's parts and the endpoint body equal the 0.4.3 baseline", async ({
  page,
}) => {
  const key = crypto.randomUUID();
  await mount(page, { endpoint: `/api/feedback/${key}`, onSubmit: undefined });
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(note(page)).toBeFocused();
  const withShot = await parts(page);
  await note(page).fill("The total is wrong");
  await button(page, "Send").click();
  await expect(page.locator("visual-feedback").locator(".status")).toBeAttached();
  const sent = await body(page, key);
  await page.goto("/widget/capture.html");
  await mount(page);
  await failable(page);
  await page.getByRole("button", { name: "Send feedback" }).click();
  await button(page, "Send without screenshot").click();
  const withoutShot = await parts(page);
  const now = { withShot, withoutShot, sent };
  // One baseline per browser: WebKit cannot encode WebP, so its screenshot part is a PNG.
  const browser = test.info().project.name;
  if (process.env.RECORD_BASELINE) {
    const all = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
    writeFileSync(BASELINE, `${JSON.stringify({ ...all, [browser]: now }, null, 2)}\n`);
  }
  expect(existsSync(BASELINE)).toBe(true);
  expect(now).toEqual(JSON.parse(readFileSync(BASELINE, "utf8"))[browser]);
});

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const text = (name: string, body: string, mimeType = "") => ({
  name,
  mimeType,
  buffer: Buffer.from(body),
});
const picker = (page: Page) => page.locator("visual-feedback").locator("input.attach-input");
const rows = (page: Page) => page.locator("visual-feedback").locator(".file-name");
const open = async (page: Page, options: Record<string, unknown>) => {
  await mount(page, { attachments: true, ...options });
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(note(page)).toBeFocused();
};

test("with attachments on, files are added and removed, and reach onSubmit typed from their names", async ({
  page,
}) => {
  await open(page, {});
  await expect(button(page, "Attach files")).toBeVisible();
  await picker(page).setInputFiles([
    { name: "bill.png", mimeType: "image/png", buffer: PNG },
    // Browsers give .md and .log no type, and .csv an Excel one: the name's ending decides.
    text("steps.log", "step 1\n"),
    text("totals.csv", "a,b\n", "application/vnd.ms-excel"),
  ]);
  await expect(rows(page)).toHaveText(["bill.png", "steps.log", "totals.csv"]);
  await button(page, "Remove steps.log").click();
  await expect(rows(page)).toHaveText(["bill.png", "totals.csv"]);
  await expect(button(page, "Attach files")).toBeFocused();
  await note(page).fill("See the files");
  await button(page, "Send").click();
  await finish(page);
  const got = await page.evaluate(async () => {
    const [report] = (window as unknown as { reports: { attachments?: { file: Blob }[] }[] })
      .reports;
    return Promise.all(
      (report?.attachments ?? []).map(async ({ file, ...rest }) => ({
        ...rest,
        type: file.type,
        text: file.type === "text/csv" ? await file.text() : file.size,
      })),
    );
  });
  expect(got).toEqual([
    { name: "bill.png", type: "image/png", size: PNG.length, text: PNG.length },
    { name: "totals.csv", type: "text/csv", size: 4, text: "a,b\n" },
  ]);
});

test("endpoint: the files reach the server's parser as file parts, checked by their bytes", async ({
  page,
}) => {
  const key = crypto.randomUUID();
  await open(page, { endpoint: `/api/feedback/${key}`, onSubmit: undefined });
  await picker(page).setInputFiles([
    { name: "bill.png", mimeType: "image/png", buffer: PNG },
    text("notes.md", "# Steps\n"),
  ]);
  await note(page).fill("Files by endpoint");
  await button(page, "Send").click();
  await confirmed(page);
  const [kept] = (await (await page.request.get(`/api/feedback/${key}`)).json()) as {
    headers: Record<string, string>;
    body: string;
  }[];
  const { report } = await parseFeedbackRequest(
    new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "content-type": kept?.headers["content-type"] ?? "" },
      body: Buffer.from(kept?.body ?? "", "base64"),
    }),
    { attachments: true },
  );
  expect(
    report.attachments?.map(({ name, type, size, file }) => [name, type, size, file.type]),
  ).toEqual([
    ["bill.png", "image/png", PNG.length, "image/png"],
    ["notes.md", "text/markdown", 8, "text/markdown"],
  ]);
});

test("each limit keeps the file out and says which limit it met", async ({ page }) => {
  await open(page, { attachments: { maxFiles: 2, maxBytes: 10, maxTotalBytes: 15 } });
  const alert = page.locator("visual-feedback").locator(".composer [role=alert]");
  await picker(page).setInputFiles([text("a.svg", "<svg/>", "image/svg+xml")]);
  await expect(alert).toHaveText(
    "a.svg is not attached: only PNG, JPEG, WebP and GIF images, PDFs and .txt, .log, .csv, .md and .json files can be.",
  );
  // An allowed type whose name the server would refuse: over 255 bytes.
  const long = `${"n".repeat(252)}.png`;
  await picker(page).setInputFiles([{ name: long, mimeType: "image/png", buffer: PNG }]);
  await expect(alert).toHaveText(
    `${long} is not attached: its name is too long, is only an ending, or holds a character that is not allowed.`,
  );
  // 256 bytes in 88 characters, and a bidi mark that would hide the real ending.
  for (const name of [`${"\u5408".repeat(84)}.png`, "photo\u202egnp.png", ".png"]) {
    await picker(page).setInputFiles([{ name, mimeType: "image/png", buffer: PNG }]);
    await expect(alert).toHaveText(
      `${name} is not attached: its name is too long, is only an ending, or holds a character that is not allowed.`,
    );
  }
  await picker(page).setInputFiles([text("big.txt", "12345678901")]);
  await expect(alert).toHaveText("big.txt is not attached: the most for one file is 10 bytes.");
  // A name holding a placeholder is shown as picked.
  await picker(page).setInputFiles([text("{limit}.txt", "12345678901")]);
  await expect(alert).toHaveText("{limit}.txt is not attached: the most for one file is 10 bytes.");
  await picker(page).setInputFiles([text("a.txt", "12345678"), text("b.txt", "12345678")]);
  await expect(alert).toHaveText(
    "b.txt is not attached: the most for all files together is 15 bytes.",
  );
  await picker(page).setInputFiles([text("c.txt", "1"), text("d.txt", "2")]);
  await expect(alert).toHaveText("d.txt is not attached: the most is 2 files.");
  await expect(rows(page)).toHaveText(["a.txt", "c.txt"]);
});

test("strings replace the attachment texts", async ({ page }) => {
  await open(page, {
    attachments: { maxFiles: 1 },
    strings: {
      attach: "X attach",
      attachments: "X attachments",
      removeAttachment: "X remove",
      attachTooMany: "X {file} {limit}",
      attachType: "X type {file}",
      attachName: "X name {file}",
    },
  });
  await picker(page).setInputFiles([
    text("a.txt", "1"),
    text("b.txt", "2"),
    text("c.exe", "3"),
    text(`${"n".repeat(252)}.txt`, "4"),
  ]);
  await expect(page.locator("visual-feedback").locator(".composer [role=alert]")).toHaveText(
    `X b.txt 1 X type c.exe X name ${"n".repeat(252)}.txt`,
  );
  await expect(button(page, "X remove a.txt")).toBeVisible();
  await expect(page.getByRole("list", { name: "X attachments" })).toBeVisible();
  await expect(button(page, "X attach")).toBeVisible();
});

test("Cancel asks first when only a file would be lost, and works without a screenshot", async ({
  page,
}) => {
  await mount(page, { attachments: true });
  await failable(page);
  await page.getByRole("button", { name: "Send feedback" }).click();
  await button(page, "Send without screenshot").click();
  await picker(page).setInputFiles([text("a.txt", "1")]);
  await button(page, "Cancel").click();
  await expect(page.getByText("Discard this feedback?")).toBeVisible();
  await button(page, "Keep editing").click();
  await note(page).fill("No picture, one file");
  await button(page, "Send").click();
  await finish(page);
  const names = await page.evaluate(() =>
    (window as unknown as { reports: { attachments?: { name: string }[] }[] }).reports.map(
      (report) => report.attachments?.map((file) => file.name),
    ),
  );
  expect(names).toEqual([["a.txt"]]);
  expect(await events(page)).toEqual(["open", "close"]);
});

test("axe passes with the files listed and a refusal shown", async ({ page }) => {
  await open(page, { attachments: { maxFiles: 1 } });
  await picker(page).setInputFiles([text("a.txt", "1"), text("b.txt", "2")]);
  await expect(rows(page)).toHaveText(["a.txt"]);
  const result = await new AxeBuilder({ page }).include("visual-feedback").analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
});

test("Save as PDF lists the files, a heading and one row each, under the note", async ({
  page,
}) => {
  await open(page, {});
  const first = await page
    .locator("visual-feedback")
    .locator("canvas.image")
    .evaluate((canvas: HTMLCanvasElement) => ({ width: canvas.width, height: canvas.height }));
  await note(page).fill("One line");
  await picker(page).setInputFiles([text("a.txt", "1"), text("b.log", "2")]);
  const saving = page.waitForEvent("download");
  await button(page, "More send options").click();
  await page.getByRole("menuitem", { name: "Save as PDF" }).click();
  const bytes = readFileSync((await (await saving).path()) ?? "");
  const height = Number(/\/Width \d+ \/Height (\d+) /.exec(bytes.toString("latin1"))?.[1]);
  const scale = first.width / 1200;
  const line = Math.round(Math.round(22 * scale) * 1.4);
  const margin = Math.round(40 * scale);
  // The note, the heading and two files: four lines above the screenshot.
  expect(height).toBe(first.height + 2 * margin + 4 * line);
});

test("an attachments option that is not true, false or a plain object makes open() reject", async ({
  page,
}) => {
  await mount(page, { attachments: "yes" });
  const outcome = await page.evaluate(() =>
    (window as unknown as { vf: { open(): Promise<void> } }).vf.open().then(
      () => "opened",
      (error: Error) => error.name,
    ),
  );
  expect(outcome).toBe("RangeError");
});

test("the Attach button opens the file picker, and the list shows each size", async ({ page }) => {
  await open(page, {});
  const choosing = page.waitForEvent("filechooser");
  await button(page, "Attach files").click();
  const chooser = await choosing;
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles([text("a.txt", "abc"), text("b.log", "x".repeat(2500))]);
  await expect(page.locator("visual-feedback").locator(".file-size")).toHaveText([
    "3 bytes",
    "3 KB",
  ]);
});

test("a fold keeps the files, and Open brings them back to send", async ({ page }) => {
  await open(page, {});
  await picker(page).setInputFiles([text("a.txt", "1")]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Feedback draft" })).toBeVisible();
  await button(page, "Open").click();
  await expect(rows(page)).toHaveText(["a.txt"]);
  await note(page).fill("Folded and back");
  await button(page, "Send").click();
  await finish(page);
  const names = await page.evaluate(() =>
    (window as unknown as { reports: { attachments?: { name: string }[] }[] }).reports.map(
      (report) => report.attachments?.map((file) => file.name),
    ),
  );
  expect(names).toEqual([["a.txt"]]);
});

test("with attachments off, onSubmit's report has no attachments key and no Attach button shows", async ({
  page,
}) => {
  await mount(page);
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(note(page)).toBeFocused();
  await expect(button(page, "Attach files")).toHaveCount(0);
  await note(page).fill("Off");
  await button(page, "Send").click();
  await finish(page);
  const keys = await page.evaluate(() =>
    (window as unknown as { reports: object[] }).reports.map((report) =>
      Object.hasOwn(report, "attachments"),
    ),
  );
  expect(keys).toEqual([false]);
});

test("strings replace the size refusals too", async ({ page }) => {
  await open(page, {
    attachments: { maxBytes: 5, maxTotalBytes: 6 },
    strings: {
      attachTooBig: "X big {file} {limit}",
      attachTooBigTogether: "X both {file} {limit}",
    },
  });
  await picker(page).setInputFiles([text("a.txt", "123456")]);
  await expect(page.locator("visual-feedback").locator(".composer [role=alert]")).toHaveText(
    "X big a.txt 5 bytes",
  );
  await picker(page).setInputFiles([text("b.txt", "1234"), text("c.txt", "1234")]);
  await expect(page.locator("visual-feedback").locator(".composer [role=alert]")).toHaveText(
    "X both c.txt 6 bytes",
  );
});

test("a limit above the maximum, or an unknown limit, makes open() reject too", async ({
  page,
}) => {
  for (const attachments of [{ maxFiles: 11 }, { maxBytes: 15_000_001 }, { maxfiles: 1 }]) {
    await page.goto("/widget/capture.html");
    await mount(page, { attachments });
    const outcome = await page.evaluate(() =>
      (window as unknown as { vf: { open(): Promise<void> } }).vf.open().then(
        () => "opened",
        (error: Error) => error.name,
      ),
    );
    expect(outcome).toBe("RangeError");
  }
});

test("closing the file picker with nothing chosen leaves the dialog as it was", async ({
  page,
}) => {
  await open(page, {});
  await note(page).fill("Still here");
  // A picker closed with nothing chosen fires a bubbling cancel on the input.
  await picker(page).dispatchEvent("cancel", { bubbles: true });
  await expect(note(page)).toBeVisible();
  await expect(page.getByRole("region", { name: "Feedback draft" })).toHaveCount(0);
  await expect(page.getByText("Discard this feedback?")).toHaveCount(0);
});

test("a file whose bytes are not what its name says is kept out, as the server would refuse it", async ({
  page,
}) => {
  await open(page, {});
  await picker(page).setInputFiles([
    { name: "photo.jpg", mimeType: "image/jpeg", buffer: PNG },
    text("utf16.csv", "a\u0000,\u0000"),
    { name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0) },
    { name: "good.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(page.locator("visual-feedback").locator(".composer [role=alert]")).toHaveText(
    [
      "photo.jpg is not attached: what it holds is not what its name says.",
      "utf16.csv is not attached: what it holds is not what its name says.",
      "empty.png is not attached: what it holds is not what its name says.",
    ].join(" "),
  );
  await expect(rows(page)).toHaveText(["good.png"]);
});

test("Send pressed while a file is still being read waits for it, and two quick picks keep the limit", async ({
  page,
}) => {
  await open(page, { attachments: { maxFiles: 1 } });
  // A slow read, as a large text file on a phone.
  await page.evaluate(() => {
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function (this: Blob) {
      return new Promise((done) => setTimeout(() => done(read.call(this)), 400));
    };
  });
  await picker(page).setInputFiles([text("a.txt", "1")]);
  await picker(page).setInputFiles([text("b.txt", "2")]);
  await note(page).fill("Sent while reading");
  await button(page, "Send").click();
  await finish(page);
  const names = await page.evaluate(() =>
    (window as unknown as { reports: { attachments?: { name: string }[] }[] }).reports.map(
      (report) => report.attachments?.map((file) => file.name),
    ),
  );
  expect(names).toEqual([["a.txt"]]);
});

test("real JPEG, WebP, GIF, PDF and JSON files are taken by the widget's own byte check", async ({
  page,
}) => {
  await open(page, {});
  const WEBP = Buffer.from(
    "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=",
    "base64",
  );
  await picker(page).setInputFiles([
    { name: "a.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 9]) },
    { name: "b.webp", mimeType: "image/webp", buffer: WEBP },
    { name: "c.gif", mimeType: "image/gif", buffer: Buffer.from("GIF87a\x01\x00") },
    { name: "d.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") },
    text("e.json", '{"a":1}', "application/json"),
  ]);
  await expect(rows(page)).toHaveText(["a.jpg", "b.webp", "c.gif", "d.pdf", "e.json"]);
  await expect(page.locator("visual-feedback").locator(".composer [role=alert]")).toHaveCount(0);
});

test("closing the picker with files listed keeps them and the note", async ({ page }) => {
  await open(page, {});
  await note(page).fill("Kept note");
  await picker(page).setInputFiles([text("a.txt", "1")]);
  await expect(rows(page)).toHaveText(["a.txt"]);
  await picker(page).dispatchEvent("cancel", { bubbles: true });
  await expect(rows(page)).toHaveText(["a.txt"]);
  await expect(note(page)).toHaveValue("Kept note");
});

test("strings.attachUnreadable replaces its text", async ({ page }) => {
  await open(page, { strings: { attachUnreadable: "X unreadable {file}" } });
  await picker(page).setInputFiles([{ name: "a.jpg", mimeType: "image/jpeg", buffer: PNG }]);
  await expect(page.locator("visual-feedback").locator(".composer [role=alert]")).toHaveText(
    "X unreadable a.jpg",
  );
});

test("widget limits that are not a count or a number of bytes make open() reject", async ({
  page,
}) => {
  for (const attachments of [
    { maxBytes: -1 },
    { maxBytes: "5" },
    { maxFiles: 1.5 },
    { maxTotalBytes: null },
  ]) {
    await page.goto("/widget/capture.html");
    await mount(page, { attachments });
    const outcome = await page.evaluate(() =>
      (window as unknown as { vf: { open(): Promise<void> } }).vf.open().then(
        () => "opened",
        (error: Error) => error.name,
      ),
    );
    expect(outcome, JSON.stringify(attachments)).toBe("RangeError");
  }
});

test("a file that cannot be read is kept out, and later picks and Send still work", async ({
  page,
}) => {
  await open(page, {});
  await page.evaluate(() => {
    const slice = Blob.prototype.slice;
    Blob.prototype.slice = function (this: Blob, ...args: Parameters<Blob["slice"]>) {
      const part = slice.apply(this, args);
      // A file deleted or moved after it was picked cannot be read.
      if (this instanceof File && this.name === "gone.txt") {
        part.arrayBuffer = () => Promise.reject(new DOMException("gone", "NotReadableError"));
      }
      return part;
    };
  });
  await picker(page).setInputFiles([text("gone.txt", "1")]);
  await expect(page.locator("visual-feedback").locator(".composer [role=alert]")).toHaveText(
    "gone.txt is not attached: what it holds is not what its name says.",
  );
  await picker(page).setInputFiles([text("ok.txt", "2")]);
  await expect(rows(page)).toHaveText(["ok.txt"]);
  await note(page).fill("After a file that could not be read");
  await button(page, "Send").click();
  await finish(page);
});

test("from Send on, Attach and Esc wait, even while a file is still being read", async ({
  page,
}) => {
  await open(page, {});
  await page.evaluate(() => {
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = function (this: Blob) {
      return new Promise((done) => setTimeout(() => done(read.call(this)), 600));
    };
  });
  await picker(page).setInputFiles([text("a.txt", "1")]);
  await note(page).fill("Sent while reading");
  await button(page, "Send").click();
  await expect(button(page, "Attach files")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Feedback draft" })).toHaveCount(0);
  await finish(page);
  const names = await page.evaluate(() =>
    (window as unknown as { reports: { attachments?: { name: string }[] }[] }).reports.map(
      (report) => report.attachments?.map((file) => file.name),
    ),
  );
  expect(names).toEqual([["a.txt"]]);
});

test("Cancel asks first when only a file would be lost, with a screenshot too", async ({
  page,
}) => {
  await open(page, {});
  await picker(page).setInputFiles([text("a.txt", "1")]);
  await expect(rows(page)).toHaveText(["a.txt"]);
  await button(page, "Cancel").click();
  await expect(page.getByText("Discard this feedback?")).toBeVisible();
});

test("after a Remove the freed room takes a new file; exact limits, upper-case endings and .jpeg are taken", async ({
  page,
}) => {
  await open(page, { attachments: { maxFiles: 2, maxBytes: 4, maxTotalBytes: 8 } });
  await picker(page).setInputFiles([text("a.txt", "1234"), text("b.txt", "5678")]);
  await expect(rows(page)).toHaveText(["a.txt", "b.txt"]);
  await button(page, "Remove a.txt").click();
  await picker(page).setInputFiles([
    { name: "IMG_0001.JPG", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0]) },
  ]);
  await expect(rows(page)).toHaveText(["b.txt", "IMG_0001.JPG"]);
  await button(page, "Remove IMG_0001.JPG").click();
  await picker(page).setInputFiles([
    { name: "photo.jpeg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 1]) },
  ]);
  await expect(rows(page)).toHaveText(["b.txt", "photo.jpeg"]);
  await expect(page.locator("visual-feedback").locator(".composer [role=alert]")).toHaveCount(0);
});

test("endpoint: each file part carries the file's own bytes, and the next report starts with none", async ({
  page,
}) => {
  const key = crypto.randomUUID();
  await open(page, { endpoint: `/api/feedback/${key}`, onSubmit: undefined });
  await picker(page).setInputFiles([text("notes.md", "# Steps\n1. open\n")]);
  await note(page).fill("First");
  await button(page, "Send").click();
  await finish(page);
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(note(page)).toBeFocused();
  await expect(rows(page)).toHaveCount(0);
  await note(page).fill("Second");
  await button(page, "Send").click();
  await finish(page);
  const kept = (await (await page.request.get(`/api/feedback/${key}`)).json()) as {
    headers: Record<string, string>;
    body: string;
  }[];
  const reports = await Promise.all(
    kept.map(async ({ headers, body }) => {
      const { report } = await parseFeedbackRequest(
        new Request("http://localhost/api/feedback", {
          method: "POST",
          headers: { "content-type": headers["content-type"] ?? "" },
          body: Buffer.from(body, "base64"),
        }),
        { attachments: true },
      );
      return Promise.all((report.attachments ?? []).map(({ file }) => file.text()));
    }),
  );
  expect(reports).toEqual([["# Steps\n1. open\n"], []]);
});
