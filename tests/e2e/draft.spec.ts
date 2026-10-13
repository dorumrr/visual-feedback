import { expect, type Page, test } from "@playwright/test";
import { events, failable, finish, type Mounted, mount, near, read } from "./widget";

const GREEN = [0x65, 0xff, 0x6b];

type Facts = { scroll: { x: number; y: number }; page: { url: string } };
type Sent = Facts & { note: string; screenshots: (Facts & { marks: { tool: string }[] })[] };

const trigger = (page: Page) => page.getByRole("button", { name: "Send feedback" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Send feedback" });
const bar = (page: Page) => page.getByRole("region", { name: "Feedback draft" });
const note = (page: Page) => page.getByRole("textbox", { name: "Your note" });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const image = (page: Page) => page.locator("visual-feedback").locator("canvas.image");

async function stroke(page: Page, y = 0.5): Promise<void> {
  const box = await image(page).boundingBox();
  if (!box) throw new Error("no image");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * y, { steps: 4 });
  await page.mouse.up();
}

async function capture(page: Page): Promise<void> {
  await button(page, "Capture this view").click();
  await expect(dialog(page)).toBeVisible();
}

const sent = (page: Page) =>
  page.evaluate(() => (window as unknown as Mounted).reports.at(-1) as unknown as Sent);

test.beforeEach(async ({ page }) => {
  await page.goto("/widget/capture.html");
});

test("two screenshots from two scroll positions go in order, each with its own marks, Undo and page", async ({
  page,
}) => {
  await mount(page, { categories: [{ id: "bug", label: "Bug" }] });
  await trigger(page).click();
  await stroke(page);
  await note(page).fill("Two views");
  await page.getByRole("combobox", { name: "Type" }).selectOption("bug");
  await button(page, "Box").click();
  await button(page, "Add screenshot").click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toContainText("Feedback draft · 1");
  await expect(trigger(page)).toBeHidden();
  // The page scrolls under the draft bar.
  await page.mouse.move(40, 40);
  await expect
    .poll(async () => {
      await page.mouse.wheel(0, 300);
      return page.evaluate(() => scrollY);
    })
    .toBeGreaterThan(200);
  // A set place, once the wheel has settled, for the second screenshot.
  await page.waitForTimeout(300);
  await page.evaluate(() => scrollTo(0, 500));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(500);
  const y = 500;
  // A single-page app moves to another route while the bar shows.
  const first = page.url();
  await page.evaluate(() => history.pushState(null, "", "/widget/other-route"));
  await capture(page);
  await expect(button(page, "Box")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "Type" })).toHaveValue("bug");
  await expect(button(page, "Screenshot 2")).toHaveAttribute("aria-current", "true");
  // Nothing in the dialog keeps the hidden state the capture gave the widget (a WebKit fault).
  const hidden = await page.evaluate(() =>
    [
      ...(document
        .querySelector("visual-feedback")
        ?.shadowRoot?.querySelectorAll(".dialog, .dialog *") ?? []),
    ]
      .filter((item) => getComputedStyle(item).visibility === "hidden")
      .map((item) => item.getAttribute("part")),
  );
  expect(hidden).toEqual([]);
  await expect(note(page)).toHaveValue("Two views");
  await stroke(page, 0.3);
  await stroke(page, 0.6);
  // Undo on screenshot 1 takes back its own stroke, not the two on screenshot 2.
  await button(page, "Screenshot 1").click();
  await expect(button(page, "Screenshot 1")).toHaveAttribute("aria-current", "true");
  await button(page, "Undo").click();
  await expect(button(page, "Undo")).toBeDisabled();
  await button(page, "Send").click();
  await finish(page);
  const report = await sent(page);
  expect(report.note).toBe("Two views");
  expect(report.screenshots.map((shot) => shot.marks.map((mark) => mark.tool))).toEqual([
    [],
    ["box", "box"],
  ]);
  expect(report.screenshots.map((shot) => shot.scroll.y)).toEqual([0, y]);
  expect(report.screenshots.map((shot) => new URL(shot.page.url).pathname)).toEqual([
    new URL(first).pathname,
    "/widget/other-route",
  ]);
  expect((report as unknown as { category: string }).category).toBe("bug");
  expect(report.page.url).toBe(report.screenshots[0]?.page.url);
  // The report's own page facts are those of the first screenshot.
  expect(report.scroll.y).toBe(0);
  expect(await events(page)).toEqual(["open", "close"]);
});

test("a screenshot can be removed, the rest keep their order, and the last one stays", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(page.getByRole("button", { name: /^Remove screenshot/ })).toHaveCount(0);
  for (let i = 0; i < 2; i++) {
    await button(page, "Add screenshot").click();
    await page.evaluate((top) => scrollTo(0, top), 100 * (i + 1));
    await capture(page);
  }
  await expect(page.getByRole("button", { name: /^Screenshot \d$/ })).toHaveCount(3);
  await button(page, "Remove screenshot 1").click();
  await expect(page.getByRole("button", { name: /^Screenshot \d$/ })).toHaveCount(2);
  // The one shown, the third, is still shown, now as number 2.
  await expect(button(page, "Screenshot 2")).toHaveAttribute("aria-current", "true");
  await button(page, "Remove screenshot 2").click();
  await expect(button(page, "Screenshot 1")).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("button", { name: /^Remove screenshot/ })).toHaveCount(0);
  await note(page).fill("One left");
  await button(page, "Send").click();
  await finish(page);
  expect((await sent(page)).screenshots.map((shot) => shot.scroll.y)).toEqual([100]);
});

test("the draft bar keeps the draft: Esc and Keep as draft fold it, Open and open() bring it back, Discard ends it", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await stroke(page);
  await note(page).fill("Kept");
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeVisible();
  await button(page, "Open").click();
  await expect(note(page)).toBeFocused();
  await expect(note(page)).toHaveValue("Kept");
  await expect(button(page, "Undo")).toBeEnabled();
  await button(page, "Keep as draft").click();
  await expect(bar(page)).toBeVisible();
  await page.evaluate(() => (window as unknown as Mounted).vf.open());
  await expect(note(page)).toHaveValue("Kept");
  expect(await events(page)).toEqual(["open"]);
  await page.keyboard.press("Escape");
  await button(page, "Discard").click();
  await expect(bar(page)).toHaveCount(0);
  await expect(trigger(page)).toBeVisible();
  expect(await events(page)).toEqual(["open", "close"]);
  // A new open starts from nothing.
  await trigger(page).click();
  await expect(note(page)).toHaveValue("");
  await expect(page.getByRole("button", { name: /^Screenshot \d$/ })).toHaveCount(1);
});

test("in a view with no screenshot, Esc cancels and no draft bar shows", async ({ page }) => {
  await mount(page, { requireNote: false });
  await failable(page);
  await trigger(page).click();
  await button(page, "Send without screenshot").click();
  await expect(note(page)).toBeFocused();
  await expect(page.getByText("Esc keeps it as a draft")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
  await expect(trigger(page)).toBeVisible();
});

test("the draft bar and the dialog are not in the screenshot the bar takes", async ({ page }) => {
  await mount(page);
  await trigger(page).click();
  await button(page, "Add screenshot").click();
  const box = await bar(page).boundingBox();
  if (!box) throw new Error("no draft bar");
  // Inside the bar and over the green corner the page draws under it.
  const point = [box.x + box.width - 24, box.y + box.height / 2];
  await capture(page);
  await note(page).fill("Bar left out");
  await button(page, "Send").click();
  await finish(page);
  const shot = await read(page, [point], undefined, false, 1);
  expect(near(shot?.at[0], GREEN), `under the bar: ${shot?.at[0]}`).toBe(true);
});

test("a screenshot that fails while adding keeps the draft and says so", async ({ page }) => {
  await mount(page);
  await failable(page);
  await page.evaluate(() => {
    (window as unknown as { failCapture: boolean }).failCapture = false;
  });
  await trigger(page).click();
  await note(page).fill("Still here");
  await button(page, "Add screenshot").click();
  await page.evaluate(() => {
    (window as unknown as { failCapture: boolean }).failCapture = true;
  });
  await capture(page);
  await expect(page.getByRole("alert")).toHaveText("Couldn't take a screenshot.");
  await expect(note(page)).toHaveValue("Still here");
  await expect(page.getByRole("button", { name: /^Screenshot \d$/ })).toHaveCount(1);
  // Esc over that message keeps the draft, as anywhere before Send.
  await page.keyboard.press("Escape");
  await expect(bar(page)).toContainText("Feedback draft · 1");
  await button(page, "Open").click();
  await expect(note(page)).toHaveValue("Still here");
  // The next try works, and the message goes.
  await button(page, "Add screenshot").click();
  await page.evaluate(() => {
    (window as unknown as { failCapture: boolean }).failCapture = false;
  });
  await capture(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Screenshot \d$/ })).toHaveCount(2);
  // Cancel over a failed add asks, then discards the draft, as anywhere else.
  await button(page, "Add screenshot").click();
  await page.evaluate(() => {
    (window as unknown as { failCapture: boolean }).failCapture = true;
  });
  await capture(page);
  await expect(page.getByRole("alert")).toHaveText("Couldn't take a screenshot.");
  await button(page, "Cancel").click();
  await page
    .getByRole("group", { name: "Discard this feedback?" })
    .getByRole("button", { name: "Discard" })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
  await expect(trigger(page)).toBeVisible();
});

test("ten screenshots is the most a draft holds", async ({ page }) => {
  await mount(page);
  await trigger(page).click();
  for (let i = 1; i < 10; i++) {
    await button(page, "Add screenshot").click();
    await capture(page);
  }
  await expect(page.getByRole("button", { name: /^Screenshot \d+$/ })).toHaveCount(10);
  await expect(button(page, "Add screenshot")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(bar(page)).toContainText("Feedback draft · 10");
  await expect(button(page, "Capture this view")).toBeDisabled();
  await expect(button(page, "Open")).toBeFocused();
  await button(page, "Open").click();
  await note(page).fill("Ten");
  await button(page, "Send").click();
  await finish(page);
  expect((await sent(page)).screenshots).toHaveLength(10);
});

test("the report's own page facts follow the first screenshot still in it", async ({ page }) => {
  await mount(page);
  await trigger(page).click();
  await button(page, "Add screenshot").click();
  await page.evaluate(() => scrollTo(0, 300));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(300);
  await capture(page);
  await button(page, "Remove screenshot 1").click();
  await note(page).fill("First one gone");
  await button(page, "Send").click();
  await finish(page);
  const report = await sent(page);
  expect(report.screenshots.map((shot) => shot.scroll.y)).toEqual([300]);
  expect(report.scroll.y).toBe(300);
  expect(report.page).toEqual(report.screenshots[0]?.page);
});

test("once Send is pressed, the hint no longer says Esc keeps a draft", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const w = window as unknown as Mounted;
    w.hold = new Promise((done) => {
      w.release = done;
    });
  });
  await trigger(page).click();
  await expect(page.getByText("Esc keeps it as a draft")).toBeVisible();
  await note(page).fill("Sending");
  await button(page, "Send").click();
  await expect(note(page)).toBeDisabled();
  await expect(page.getByText("Esc keeps it as a draft")).toHaveCount(0);
  await page.evaluate(() => (window as unknown as Mounted).release?.());
  await finish(page);
});

test("each screenshot's image has its own marks painted in", async ({ page }) => {
  await mount(page, { capture: { type: "image/png" } });
  await trigger(page).click();
  await stroke(page);
  await button(page, "Add screenshot").click();
  await capture(page);
  await stroke(page, 0.3);
  await button(page, "Screenshot 1").click();
  await button(page, "Undo").click();
  await note(page).fill("Marks per image");
  await button(page, "Send").click();
  await finish(page);
  const mark = [0xe5, 0x24, 0x3b];
  const first = await read(page, [], mark, false, 0);
  const second = await read(page, [], mark, false, 1);
  expect(first?.counted).toBe(0);
  expect(second?.counted).toBeGreaterThan(50);
});

test("close() ends a draft kept in the bar, and destroy() takes the bar away", async ({ page }) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeVisible();
  await page.evaluate(() => (window as unknown as Mounted).vf.close());
  await expect(bar(page)).toHaveCount(0);
  await expect(trigger(page)).toBeVisible();
  expect(await events(page)).toEqual(["open", "close"]);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeVisible();
  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  await expect(page.locator("visual-feedback")).toHaveCount(0);
  // destroy() keeps the folded draft for the next widget: it did not end, so no close.
  expect(await events(page)).toEqual(["open", "close", "open"]);
});

test("the draft bar sits in the trigger's corner, and shows with trigger none too", async ({
  page,
}) => {
  await mount(page, { position: "top-left" });
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  const box = await bar(page).boundingBox();
  expect([Math.round(box?.x ?? 0), Math.round(box?.y ?? 0)]).toEqual([16, 16]);
  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  await mount(page, { trigger: "none" });
  await page.evaluate(() => (window as unknown as Mounted).vf.open());
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  const corner = await bar(page).boundingBox();
  const view = page.viewportSize();
  expect(Math.round((view?.width ?? 0) - (corner?.x ?? 0) - (corner?.width ?? 0))).toBe(16);
  expect(Math.round((view?.height ?? 0) - (corner?.y ?? 0) - (corner?.height ?? 0))).toBe(16);
});

test("open() while the bar takes a screenshot leaves the dialog hidden until it is taken", async ({
  page,
}) => {
  await mount(page);
  await failable(page);
  await page.evaluate(() => {
    (window as unknown as { failCapture: boolean }).failCapture = false;
  });
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await button(page, "Add screenshot").click();
  await page.evaluate(() => {
    const w = window as unknown as { holdCapture: Promise<void>; letGo: () => void };
    w.holdCapture = new Promise((done) => {
      w.letGo = done;
    });
  });
  await button(page, "Capture this view").click();
  await page.evaluate(() => (window as unknown as Mounted).vf.open());
  await page.waitForTimeout(200);
  await expect(dialog(page)).toBeHidden();
  await page.evaluate(() => (window as unknown as { letGo: () => void }).letGo());
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Screenshot \d$/ })).toHaveCount(2);
});

test("after a send error, Esc asks, then Discard closes the dialog and no draft bar shows", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() =>
    (window as unknown as Mounted).vf.update({
      onSubmit: () => Promise.reject(new Error("Server says no")),
    }),
  );
  await trigger(page).click();
  await note(page).fill("Fails");
  await button(page, "Send").click();
  await expect(button(page, "Try again")).toBeVisible();
  await expect(page.getByText("Esc keeps it as a draft")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("group", { name: "Discard this feedback?" })
    .getByRole("button", { name: "Discard" })
    .click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
  await expect(trigger(page)).toBeVisible();
  expect(await events(page)).toEqual(["open", "close"]);
});

test("thumbnails follow their own screenshot's marks, in the strip and in the draft bar", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  // A thumbnail's pixels, summed: a stroke too thin to stay red still changes them.
  const pixels = (selector: string) =>
    page.evaluate(
      (selector) =>
        [
          ...(document
            .querySelector("visual-feedback")
            ?.shadowRoot?.querySelectorAll<HTMLCanvasElement>(selector) ?? []),
        ].map((thumb) =>
          [
            ...(thumb.getContext("2d")?.getImageData(0, 0, thumb.width, thumb.height).data ?? []),
          ].reduce((sum, value) => sum + value, 0),
        ),
      selector,
    );
  const strip = () => pixels(".strip .thumb-image");
  await expect(image(page)).toBeVisible();
  const [before = 0] = await strip();
  expect(before).toBeGreaterThan(0);
  await stroke(page);
  await expect.poll(async () => (await strip())[0]).not.toBe(before);
  await button(page, "Undo").click();
  await expect.poll(async () => (await strip())[0]).toBe(before);
  await stroke(page);
  await button(page, "Clear").click();
  await page
    .getByRole("group", { name: "Clear all marks on this screenshot?" })
    .getByRole("button", { name: "Clear", exact: true })
    .click();
  await expect.poll(async () => (await strip())[0]).toBe(before);
  // A second screenshot: marks on it change its thumbnail, never the first one's.
  await button(page, "Add screenshot").click();
  await capture(page);
  const [, second = 0] = await strip();
  await stroke(page);
  await expect.poll(async () => (await strip())[1]).not.toBe(second);
  expect((await strip())[0]).toBe(before);
  // The draft bar shows one small copy per screenshot, the marks included.
  await page.keyboard.press("Escape");
  const copies = await pixels(".draft-thumbs .thumb-image");
  expect(copies).toHaveLength(2);
  expect(copies[0]).toBe(before);
  expect(copies[1]).not.toBe(second);
});

test("Capture this view has the accent colour, as Send does", async ({ page }) => {
  await mount(page);
  await trigger(page).click();
  const accent = await button(page, "Send").evaluate(
    (send) => getComputedStyle(send).backgroundColor,
  );
  await page.keyboard.press("Escape");
  await expect(button(page, "Capture this view")).toHaveCSS("background-color", accent);
});

test("Clear clears the screenshot it asked about, even when another one is picked before the answer", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await stroke(page);
  await button(page, "Add screenshot").click();
  await capture(page);
  await stroke(page, 0.7);
  await button(page, "Screenshot 1").click();
  await button(page, "Clear").click();
  await button(page, "Screenshot 2").click();
  await page
    .getByRole("group", { name: "Clear all marks on this screenshot?" })
    .getByRole("button", { name: "Clear", exact: true })
    .click();
  // Screenshot 2 is shown and keeps its mark: Clear stays on, and the focus stays in the dialog.
  await expect(button(page, "Clear")).toBeEnabled();
  await expect(page.locator("visual-feedback").locator(":focus")).toHaveCount(1);
  await note(page).fill("two screenshots");
  await button(page, "Send").click();
  await finish(page);
  const report = await sent(page);
  expect(report.screenshots.map((shot) => shot.marks.length)).toEqual([0, 1]);
});
