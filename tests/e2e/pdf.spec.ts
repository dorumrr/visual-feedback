import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { events, failable, finish, type Mounted, mount } from "./widget";

const trigger = (page: Page) => page.getByRole("button", { name: "Send feedback" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Send feedback" });
const note = (page: Page) => page.getByRole("textbox", { name: "Your note" });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const image = (page: Page) => page.locator("visual-feedback").locator("canvas.image");
const more = (page: Page) => button(page, "More send options");
const save = (page: Page) => page.getByRole("menuitem", { name: "Save as PDF" });

/** Saves the PDF from the menu and returns its file name and bytes. */
async function download(page: Page): Promise<{ name: string; bytes: Buffer }> {
  const saving = page.waitForEvent("download");
  await more(page).click();
  await save(page).click();
  const file = await saving;
  return { name: file.suggestedFilename(), bytes: readFileSync((await file.path()) ?? "") };
}

/** Walks the file as a reader does, from the trailer to each page's image, and returns the JPEGs. */
function parse(bytes: Buffer): {
  pages: number;
  jpegs: Buffer[];
  sizes: { width: number; height: number }[];
} {
  const text = bytes.toString("latin1");
  expect(text.startsWith("%PDF-1.4\n")).toBe(true);
  expect(text.endsWith("%%EOF\n")).toBe(true);
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
  expect(text.slice(start, start + 4)).toBe("xref");
  const rows = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((row) =>
    Number(row[1]),
  );
  for (const [i, offset] of rows.entries()) {
    expect(text.startsWith(`${i + 1} 0 obj`, offset), `object ${i + 1}`).toBe(true);
  }
  const object = (n: number) => text.slice(rows[n - 1] ?? 0, text.indexOf("endobj", rows[n - 1]));
  expect(text).toContain(`trailer\n<< /Size ${rows.length + 1} /Root 1 0 R >>`);
  expect(object(1)).toContain("/Type /Catalog /Pages 2 0 R");
  const tree = /\/Kids \[([^\]]*)\] \/Count (\d+)/.exec(object(2));
  const kids = [...(tree?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map((kid) => Number(kid[1]));
  const pages = Number(tree?.[2]);
  expect(kids).toHaveLength(pages);
  // Each page draws its own image; the JPEGs come back in the order the page tree lists them.
  const sizes: { width: number; height: number }[] = [];
  const jpegs = kids.map((kid) => {
    const page = object(kid);
    expect(page).toContain("/Type /Page ");
    const image = Number(/\/I (\d+) 0 R/.exec(page)?.[1]);
    const contents = Number(/\/Contents (\d+) 0 R/.exec(page)?.[1]);
    expect(object(contents)).toContain("/I Do Q");
    const head = object(image);
    const size = /\/Width (\d+) \/Height (\d+) /.exec(head);
    sizes.push({ width: Number(size?.[1]), height: Number(size?.[2]) });
    const length = Number(/\/DCTDecode \/Length (\d+) >>/.exec(head)?.[1]);
    const from = (rows[image - 1] ?? 0) + head.indexOf("stream\n") + "stream\n".length;
    return bytes.subarray(from, from + length);
  });
  return { pages, jpegs, sizes };
}

type Decoded = { width: number; height: number; ink: number; red: number };

/** Each JPEG decoded by the browser: its size, the dark pixels in its top band (the text), and
 * the pixels in the mark colour. */
function decode(page: Page, jpegs: Buffer[]): Promise<Decoded[]> {
  return page.evaluate(
    async (all) => {
      const out = [];
      for (const base64 of all) {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        context?.drawImage(bitmap, 0, 0);
        const data = context?.getImageData(0, 0, canvas.width, canvas.height).data ?? [];
        let ink = 0;
        let red = 0;
        for (let i = 0; i < data.length; i += 4) {
          const [r = 0, g = 0, b = 0] = [data[i], data[i + 1], data[i + 2]];
          if (i < canvas.width * 120 * 4 && r < 100) ink++;
          if (r > 180 && g < 90 && b < 110) red++;
        }
        out.push({ width: bitmap.width, height: bitmap.height, ink, red });
      }
      return out;
    },
    jpegs.map((jpeg) => jpeg.toString("base64")),
  );
}

const sizeOf = (page: Page) =>
  image(page).evaluate((canvas: HTMLCanvasElement) => ({
    width: canvas.width,
    height: canvas.height,
  }));

const ZONE = "Pacific/Kiritimati";

/** The user's own date in ZONE, as the file name carries it. */
function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date());
}

/** Makes the page's JPEG encodes wait for `letGo()`, or fail at once with `fail`. */
function holdJpeg(page: Page, fail = false): Promise<void> {
  return page.evaluate((fail) => {
    const w = window as unknown as { letGo: () => void; held: Promise<void>; encoded: number };
    w.encoded = 0;
    w.held = new Promise((done) => {
      w.letGo = done;
    });
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (type !== "image/jpeg") return toBlob.call(this, callback, type, quality);
      if (fail) return callback(null);
      void w.held.then(() =>
        toBlob.call(
          this,
          (blob) => {
            callback(blob);
            w.encoded++;
          },
          type,
          quality,
        ),
      );
    };
  }, fail);
}

const letGo = (page: Page) =>
  page.evaluate(() => (window as unknown as { letGo: () => void }).letGo());

/** Waits until `count` JPEG encodes have finished, then a little for what follows them. */
async function encoded(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { encoded: number }).encoded))
    .toBeGreaterThanOrEqual(count);
  await page.waitForTimeout(200);
}

// UTC+14: there, the date differs from UTC's from 10:00 UTC on, which a UTC file name would miss.
test.use({ timezoneId: ZONE });

test.beforeEach(async ({ page }) => {
  await page.goto("/widget/capture.html");
});

test("Save as PDF holds every screenshot in order with its marks, and the note, sends nothing, and keeps the draft", async ({
  page,
}) => {
  await mount(page, { categories: [{ id: "bug", label: "Bug" }] });
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  const first = await sizeOf(page);
  await note(page).fill("The total is wrong");
  await button(page, "Add screenshot").click();
  await button(page, "Capture this view").click();
  await expect(button(page, "Screenshot 2")).toBeVisible();
  const second = await sizeOf(page);
  await button(page, "Add screenshot").click();
  await button(page, "Capture this view").click();
  await expect(button(page, "Screenshot 3")).toBeVisible();
  // A box on screenshot 3 only: its page must be the one in the mark colour.
  await button(page, "Box").click();
  const box = await image(page).boundingBox();
  if (!box) throw new Error("no image");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 4 });
  await page.mouse.up();
  const { name, bytes } = await download(page);
  expect(name).toBe(`feedback-${today()}.pdf`);
  const { pages, jpegs, sizes } = parse(bytes);
  expect(pages).toBe(3);
  const decoded = await decode(page, jpegs);
  // The size a reader takes from each image's header is the JPEG's own.
  expect(sizes).toEqual(decoded.map(({ width, height }) => ({ width, height })));
  const [cover, middle, last] = decoded;
  // Page 1: the category and the note, one line each, above screenshot 1, which has no mark.
  const scale = first.width / 1200;
  const line = Math.round(Math.round(22 * scale) * 1.4);
  const margin = Math.round(40 * scale);
  expect(cover?.width).toBe(first.width);
  expect(cover?.height).toBe(first.height + 2 * margin + 2 * line);
  expect(cover?.ink).toBeGreaterThan(50);
  expect(cover?.red).toBe(0);
  // Page 2: screenshot 2, unmarked; page 3: screenshot 3, with its box.
  expect([middle?.width, middle?.height]).toEqual([second.width, second.height]);
  expect(middle?.red).toBe(0);
  expect(last?.red).toBeGreaterThan(200);
  // Nothing was sent, the dialog and the note stay, and the host heard of it.
  await expect(dialog(page)).toBeVisible();
  await expect(note(page)).toHaveValue("The total is wrong");
  expect(await page.evaluate(() => (window as unknown as Mounted).reports)).toEqual([]);
  expect(await events(page)).toEqual(["open", "saved"]);
  await expect(more(page)).toHaveAttribute("aria-expanded", "false");
  // And Send still sends the same draft.
  await button(page, "Send").click();
  await finish(page);
});

test("the menu works from the keyboard, Esc and Tab close only the menu, and so does a click elsewhere", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(note(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(button(page, "Send")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(more(page)).toBeFocused();
  await expect(more(page)).toHaveAttribute("aria-haspopup", "menu");
  await page.keyboard.press("Enter");
  await expect(more(page)).toHaveAttribute("aria-expanded", "true");
  await expect(save(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(save(page)).toBeHidden();
  await expect(more(page)).toBeFocused();
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByRole("region", { name: "Feedback draft" })).toHaveCount(0);
  // Shift+Tab closes it and goes back to Send.
  await page.keyboard.press("Enter");
  await expect(save(page)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(save(page)).toBeHidden();
  await expect(button(page, "Send")).toBeFocused();
  // Space opens it too; Tab closes it and goes on past the menu button.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await expect(save(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(save(page)).toBeHidden();
  await expect(button(page, "Keep as draft")).toBeFocused();
  // A click elsewhere in the dialog closes it.
  await more(page).click();
  await expect(save(page)).toBeVisible();
  await note(page).click();
  await expect(save(page)).toBeHidden();
  await expect(more(page)).toHaveAttribute("aria-expanded", "false");
});

test("with the menu open, Esc on the menu button or on Send closes only the menu", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  for (const target of [more(page), button(page, "Send")]) {
    await more(page).click();
    await expect(save(page)).toBeFocused();
    // As after a press on the button that was not let go on it.
    await target.focus();
    await expect(save(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(save(page)).toBeHidden();
    await expect(more(page)).toBeFocused();
    await expect(more(page)).toHaveAttribute("aria-expanded", "false");
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByRole("region", { name: "Feedback draft" })).toHaveCount(0);
  }
  // With the menu closed, Esc keeps the draft as before.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Feedback draft" })).toBeVisible();
});

test("Enter on Save as PDF leaves the focus on the menu button", async ({ page }) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  const saving = page.waitForEvent("download");
  await more(page).click();
  await expect(save(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await saving;
  await expect(more(page)).toBeFocused();
});

test("without a screenshot, the PDF is the note alone", async ({ page }) => {
  await mount(page);
  await failable(page);
  await trigger(page).click();
  await button(page, "Send without screenshot").click();
  await note(page).fill("No picture");
  const { pages, jpegs } = parse((await download(page)).bytes);
  expect(pages).toBe(1);
  const [cover] = await decode(page, jpegs);
  expect(cover?.width).toBe(1200);
  expect(cover?.ink).toBeGreaterThan(50);
});

test("a page that cannot be copied fails like any other PDF error, and the next save works", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.evaluate(() => {
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    let once = true;
    CanvasRenderingContext2D.prototype.drawImage = function (
      this: CanvasRenderingContext2D,
      ...args: unknown[]
    ) {
      if (once && (this.canvas as HTMLCanvasElement).isConnected === false) {
        once = false;
        throw new DOMException("no copy", "InvalidStateError");
      }
      return (drawImage as (...a: unknown[]) => void).apply(this, args);
    } as typeof drawImage;
  });
  await more(page).click();
  await save(page).click();
  await expect(page.getByRole("alert")).toHaveText("Couldn't save the PDF.");
  const saving = page.waitForEvent("download");
  await more(page).click();
  await save(page).click();
  await saving;
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("Send takes the PDF message away", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const w = window as unknown as Mounted;
    w.hold = new Promise((done) => {
      w.release = done;
    });
  });
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await holdJpeg(page, true);
  await more(page).click();
  await save(page).click();
  await expect(page.getByRole("alert")).toHaveText("Couldn't save the PDF.");
  await note(page).fill("Send anyway");
  await button(page, "Send").click();
  await expect(note(page)).toBeDisabled();
  await expect(page.getByText("Couldn't save the PDF.")).toHaveCount(0);
  await page.evaluate(() => (window as unknown as Mounted).release?.());
  await finish(page);
});

test("a PDF that cannot be made says so, and fires no saved event", async ({ page }) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await holdJpeg(page, true);
  // Nothing failed to send, so the host's error event, which means that, stays quiet.
  await page.evaluate(() => {
    const w = window as unknown as Mounted & { errors: number };
    w.errors = 0;
    w.vf.on("error", () => w.errors++);
  });
  await more(page).click();
  await save(page).click();
  await expect(page.getByRole("alert")).toHaveText("Couldn't save the PDF.");
  expect(await events(page)).toEqual(["open"]);
  expect(await page.evaluate(() => (window as unknown as { errors: number }).errors)).toBe(0);
  await expect(dialog(page)).toBeVisible();
});

test("a second Save while the first builds makes one file, and a fold meanwhile still saves it", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await holdJpeg(page);
  let downloads = 0;
  page.on("download", () => downloads++);
  await more(page).click();
  await save(page).click();
  await more(page).click();
  await save(page).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Feedback draft" })).toBeVisible();
  const saving = page.waitForEvent("download");
  await letGo(page);
  await saving;
  // Long enough for a second build: twice the encodes one build needs.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { encoded: number }).encoded)).toBe(1);
  expect(downloads).toBe(1);
  expect(await events(page)).toEqual(["open", "saved"]);
});

test("Cancel while the PDF builds saves nothing and fires no saved event", async ({ page }) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await holdJpeg(page);
  let downloads = 0;
  page.on("download", () => downloads++);
  await more(page).click();
  await save(page).click();
  await button(page, "Cancel").click();
  await letGo(page);
  await encoded(page, 1);
  expect(downloads).toBe(0);
  expect(await events(page)).toEqual(["open", "close"]);
});

test("while sending, the menu cannot be opened", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const w = window as unknown as Mounted;
    w.hold = new Promise((done) => {
      w.release = done;
    });
  });
  await trigger(page).click();
  await note(page).fill("Held");
  await button(page, "Send").click();
  await expect(more(page)).toBeDisabled();
  await page.evaluate(() => (window as unknown as Mounted).release?.());
  await finish(page);
});

test("Send closes an open menu, so Esc while sending closes the dialog", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const w = window as unknown as Mounted;
    w.hold = new Promise((done) => {
      w.release = done;
    });
  });
  await trigger(page).click();
  await note(page).fill("Held");
  await more(page).click();
  await expect(save(page)).toBeFocused();
  await button(page, "Send").click();
  await expect(more(page)).toBeDisabled();
  await expect(save(page)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole("region", { name: "Feedback draft" })).toHaveCount(0);
  expect(await events(page)).toContain("close");
  await page.evaluate(() => (window as unknown as Mounted).release?.());
});

test("strings.pdfError replaces the message", async ({ page }) => {
  await mount(page, { strings: { pdfError: "X pdfError" } });
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await holdJpeg(page, true);
  await more(page).click();
  await save(page).click();
  await expect(page.getByRole("alert")).toHaveText("X pdfError");
});

test("a copy the browser gives no 2D context, as iOS past its canvas memory, fails loudly, never as a blank page", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  let downloads = 0;
  page.on("download", () => downloads++);
  const shot = await sizeOf(page);
  await page.evaluate((shot) => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    // Only the PDF's copies: out of the page and the screenshot's size, never the cover.
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: unknown[]
    ) {
      if (
        args[0] === "2d" &&
        this.width === shot.width &&
        this.height === shot.height &&
        !this.isConnected
      ) {
        return null;
      }
      return (getContext as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof getContext;
  }, shot);
  await more(page).click();
  await save(page).click();
  await expect(page.getByRole("alert")).toHaveText("Couldn't save the PDF.");
  await page.waitForTimeout(300);
  expect(downloads).toBe(0);
});

test("each copy is freed once its page is encoded, not only at the end", async ({ page }) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await button(page, "Add screenshot").click();
  await button(page, "Capture this view").click();
  await expect(button(page, "Screenshot 2")).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { made: HTMLCanvasElement[]; during: number[] };
    w.made = [];
    w.during = [];
    // At the second page's encode, the cover and the first copy must already be let go.
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    let jpegs = 0;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (type === "image/jpeg" && ++jpegs === 2) w.during = w.made.map((canvas) => canvas.width);
      return toBlob.call(this, callback, type, quality);
    };
    const createElement = document.createElement.bind(document);
    document.createElement = ((name: string, options?: ElementCreationOptions) => {
      const element = createElement(name, options);
      if (name === "canvas") w.made.push(element as HTMLCanvasElement);
      return element;
    }) as typeof document.createElement;
  });
  const saving = page.waitForEvent("download");
  await more(page).click();
  await save(page).click();
  await saving;
  // Two copies and the cover, at least; every one of them let go.
  const widths = await page.evaluate(() =>
    (window as unknown as { made: HTMLCanvasElement[] }).made.map((canvas) => canvas.width),
  );
  expect(widths.length).toBeGreaterThanOrEqual(3);
  expect(widths.filter((width) => width > 0)).toEqual([]);
  const during = await page.evaluate(() => (window as unknown as { during: number[] }).during);
  expect(during.length).toBeGreaterThanOrEqual(3);
  // Only the page being encoded still holds its pixels.
  expect(during.filter((width) => width > 0)).toHaveLength(1);
});

test("the cover shows the category's label, not its id", async ({ page }) => {
  const label = "A category label long enough to wrap ".repeat(8).trim();
  await mount(page, { categories: [{ id: "x", label }] });
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  const first = await sizeOf(page);
  await note(page).fill("One line");
  const { jpegs } = parse((await download(page)).bytes);
  const [cover] = await decode(page, jpegs);
  const scale = first.width / 1200;
  const line = Math.round(Math.round(22 * scale) * 1.4);
  const margin = Math.round(40 * scale);
  // The id "x" would take one line above the note; the label wraps over several.
  const lines = ((cover?.height ?? 0) - first.height - 2 * margin) / line;
  expect(lines).toBeGreaterThanOrEqual(4);
});
