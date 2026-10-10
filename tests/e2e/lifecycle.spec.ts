import { expect, type Page, test } from "@playwright/test";
import { failable, type Mounted, mount } from "./widget";

type Entry = { target: string; type: string; from: string; added: number; removed: number };

// Every add and remove on window and document, matched by listener, type and capture, and
// tagged with who added it: the capture library's file, or anything else.
function spy(): void {
  const log = new Map<string, Entry>();
  const fns: unknown[] = [];
  const key = (target: EventTarget, type: string, fn: unknown, options?: unknown) => {
    const capture =
      typeof options === "boolean" ? options : Boolean((options as { capture?: boolean })?.capture);
    if (!fns.includes(fn)) fns.push(fn);
    return `${target === window ? "window" : "document"}|${type}|${capture}|${fns.indexOf(fn)}`;
  };
  // The nearest module frame is the caller: the library's file, the widget's, or none (the
  // test runner's own page scripts).
  const caller = () => {
    const frame = (new Error().stack ?? "").split("\n").find((line) => /\.mjs/.test(line));
    if (!frame) return "other";
    return /snapdom/.test(frame) ? "capture library" : "widget";
  };
  const { addEventListener: add, removeEventListener: remove } = EventTarget.prototype;
  EventTarget.prototype.addEventListener = function (type, fn, options) {
    if ((this === window || this === document) && fn) {
      const id = key(this, type, fn, options);
      const from = caller();
      const entry = log.get(id) ?? {
        target: id.split("|")[0] ?? "",
        type,
        from,
        added: 0,
        removed: 0,
      };
      entry.added++;
      log.set(id, entry);
    }
    return add.call(this, type, fn, options);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, options) {
    if ((this === window || this === document) && fn) {
      const entry = log.get(key(this, type, fn, options));
      if (entry) entry.removed++;
    }
    return remove.call(this, type, fn, options);
  };
  const observing = new Map<MutationObserver, string>();
  const { observe, disconnect } = MutationObserver.prototype;
  MutationObserver.prototype.observe = function (...args) {
    observing.set(this, caller());
    return observe.apply(this, args);
  };
  MutationObserver.prototype.disconnect = function () {
    observing.delete(this);
    return disconnect.call(this);
  };
  Object.assign(window, { log, observing });
}

// SPEC §9: what the capture library keeps after its first screenshot; it offers no way to remove them.
const KEPT = [
  "document beforetoggle",
  "document change",
  "document focusin",
  "document focusout",
  "document keydown",
  "document keyup",
  "document pointercancel",
  "document pointerdown",
  "document pointerup",
  "document toggle",
  "window hashchange",
  "window resize",
];

/** After destroy: every listener the widget added is removed, and only the library's are kept,
 * those of a capture that ran. */
async function nothingLeft(page: Page, captured = true, observing = 5): Promise<void> {
  const entries = await listeners(page);
  const own = entries.filter((entry) => entry.from === "widget");
  expect(own.length).toBeGreaterThan(0);
  for (const entry of own) expect(entry.removed, `${entry.target} ${entry.type}`).toBe(entry.added);
  const kept = entries
    .filter((entry) => entry.from === "capture library" && entry.removed < entry.added)
    .map((entry) => `${entry.target} ${entry.type}`);
  expect(kept.sort()).toEqual(captured ? KEPT : []);
  const observers = await page.evaluate(() =>
    [...(window as unknown as { observing: Map<unknown, string> }).observing.values()]
      .filter((from) => from !== "other")
      .sort(),
  );
  expect(observers).toEqual(Array(captured ? observing : 0).fill("capture library"));
}

const listeners = (page: Page) =>
  page.evaluate(() => [...(window as unknown as { log: Map<string, Entry> }).log.values()]);

// What the page holds outside the widget: every element with its attributes, and stylesheets.
const snapshot = (page: Page) =>
  page.evaluate(() => ({
    elements: [...document.querySelectorAll("*")].map(
      (element) => (element.cloneNode(false) as Element).outerHTML,
    ),
    sheets: document.styleSheets.length,
    adopted: document.adoptedStyleSheets.length,
  }));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(spy);
  await page.goto("/widget/");
});

test("after open, update and destroy with the shortcut on, nothing is left", async ({ page }) => {
  const before = await snapshot(page);
  await mount(page, { shortcut: "Alt+Shift+F" });
  expect(await listeners(page)).toEqual([
    { target: "window", type: "keydown", from: "widget", added: 1, removed: 0 },
  ]);

  await page.keyboard.press("Alt+Shift+KeyF");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.evaluate(() =>
    (window as unknown as Mounted).vf.update({
      shortcut: "Control+Alt+K",
      position: "top-left",
      theme: "dark",
      css: ".trigger{outline:1px solid red}",
      strings: { trigger: "Feedback" },
    }),
  );
  await expect(page.getByRole("button", { name: "Feedback", exact: true })).toBeVisible();
  await page.keyboard.press("Alt+Shift+KeyF");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Control+Alt+KeyK");
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  await nothingLeft(page);
  expect(await snapshot(page)).toEqual(before);
  await page.keyboard.press("Control+Alt+KeyK");
  await expect(page.locator("visual-feedback")).toHaveCount(0);
});

test("destroy while the dialog is open leaves nothing, and later calls do nothing", async ({
  page,
}) => {
  const before = await snapshot(page);
  await mount(page, { shortcut: "Alt+Shift+F" });
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() => {
    const widget = (window as unknown as Mounted).vf;
    widget.destroy();
    widget.update({ shortcut: "Alt+Shift+G", trigger: "button" });
    void widget.open();
    widget.destroy();
  });
  await nothingLeft(page);
  expect(await snapshot(page)).toEqual(before);
});

test("no shortcut adds no listener to window or document", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => (window as unknown as Mounted).vf.update({ position: "top-left" }));
  expect(await listeners(page)).toEqual([]);
});

test("destroy during the capture, while drawing, and while sending leaves nothing", async ({
  page,
}) => {
  const before = await snapshot(page);
  await mount(page, { shortcut: "Alt+Shift+F" });
  // Destroyed before the dialog code arrives: the capture never runs.
  await page.evaluate(async () => {
    const widget = (window as unknown as Mounted).vf;
    const opening = widget.open();
    widget.destroy();
    await opening;
  });
  await nothingLeft(page, false);
  expect(await snapshot(page)).toEqual(before);

  await mount(page, { shortcut: "Alt+Shift+F" });
  await page.getByRole("button", { name: "Send feedback" }).click();
  const image = page.locator("visual-feedback").locator(".image");
  const box = await image.boundingBox();
  if (!box) throw new Error("no image");
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  await page.mouse.up();
  await nothingLeft(page);
  expect(await snapshot(page)).toEqual(before);

  await page.evaluate(() => {
    const w = window as unknown as Mounted;
    w.hold = new Promise((resolve) => {
      w.release = resolve;
    });
  });
  await mount(page, { shortcut: "Alt+Shift+F" });
  await page.getByRole("button", { name: "Send feedback" }).click();
  await page.getByLabel("Your note").fill("A note");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sending…" })).toBeVisible();
  // Submitted and held in onSubmit, so the delivery is under way when destroy() runs.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Mounted).reports.length))
    .toBe(1);
  await page.evaluate(async () => {
    const w = window as unknown as Mounted;
    w.vf.on("sent", () => w.events.push("sent"));
    w.vf.on("error", () => w.events.push("error"));
    w.vf.destroy();
    w.release?.();
    // Long enough for the sent state and its 3 s timer to have started, had they survived.
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  // destroy() fires close last; the delivery under way fires nothing after it.
  expect(await page.evaluate(() => (window as unknown as Mounted).events.at(-1))).toBe("close");
  await nothingLeft(page);
  expect(await snapshot(page)).toEqual(before);
});

test("a shortcut added by update is removed by update and by destroy", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => (window as unknown as Mounted).vf.update({ shortcut: "Alt+Shift+F" }));
  expect(await listeners(page)).toEqual([
    { target: "window", type: "keydown", from: "widget", added: 1, removed: 0 },
  ]);
  await page.evaluate(() => (window as unknown as Mounted).vf.update({ shortcut: false }));
  expect(await listeners(page)).toEqual([
    { target: "window", type: "keydown", from: "widget", added: 1, removed: 1 },
  ]);
  await page.evaluate(() => {
    const widget = (window as unknown as Mounted).vf;
    widget.update({ shortcut: "Alt+Shift+G" });
    widget.destroy();
  });
  for (const entry of await listeners(page)) expect(entry.removed).toBe(entry.added);
});

test("destroy while the screenshot is still being taken leaves nothing when it ends", async ({
  page,
}) => {
  const before = await snapshot(page);
  await failable(page);
  await page.evaluate(() => {
    const w = window as unknown as Mounted & { failCapture: boolean; holdCapture: Promise<void> };
    w.failCapture = false;
    w.holdCapture = new Promise((resolve) => {
      w.release = resolve;
    });
  });
  await mount(page, { shortcut: "Alt+Shift+F" });
  await page.evaluate(async () => {
    const w = window as unknown as Mounted & { calls?: number };
    const opening = w.vf.open();
    while (!w.calls) await new Promise((resolve) => setTimeout(resolve, 10));
    w.vf.destroy();
    w.release?.();
    await opening;
  });
  // Fewer observers here: the library adds some only for shadow roots still in the page.
  await nothingLeft(page, true, 3);
  expect(await snapshot(page)).toEqual(before);
});

test("updating the shortcut again and again keeps one keydown listener", async ({ page }) => {
  await mount(page, { shortcut: "Alt+Shift+F" });
  await page.evaluate(() => {
    const widget = (window as unknown as Mounted).vf;
    for (const shortcut of ["Alt+Shift+F", "Alt+Shift+G", "Control+K"]) widget.update({ shortcut });
    widget.update({ position: "top-left" });
  });
  const live = (await listeners(page)).reduce((sum, entry) => sum + entry.added - entry.removed, 0);
  expect(live).toBe(1);
});
