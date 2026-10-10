import { expect, type Page, test } from "@playwright/test";
import { events, finish, type Mounted, mount, read } from "./widget";

type Sent = {
  note: string;
  category?: string;
  screenshots: {
    marks: { tool: string }[];
    scroll: { y: number };
    viewport: { width: number; height: number; devicePixelRatio: number };
    page: { url: string; title: string };
  }[];
};

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

/** How many drafts the device holds, and how old the oldest is. */
const stored = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const request = indexedDB.open("visual-feedback", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("drafts");
        request.onsuccess = () => {
          const db = request.result;
          const count = db.transaction("drafts").objectStore("drafts").count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
        };
      }),
  );

/** The note of the one draft the device holds. */
const storedNote = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string | undefined>((resolve) => {
        const request = indexedDB.open("visual-feedback", 1);
        request.onsuccess = () => {
          const cursors = request.result.transaction("drafts").objectStore("drafts").openCursor();
          cursors.onsuccess = () => resolve(cursors.result?.value.note);
        };
      }),
  );

/** Loads the page again, as a link to another page of the site would, and mounts the widget. */
async function load(page: Page, options: Record<string, unknown> = {}): Promise<void> {
  await page.reload();
  await mount(page, options);
}

/** True once the dialog's code was fetched: a page with nothing kept must never fetch it at load. */
async function dialogLoaded(page: Page): Promise<boolean> {
  // Long enough for a load-time restore to have asked for the chunk, had it been going to.
  await page.waitForTimeout(500);
  return page.evaluate(() =>
    performance.getEntriesByType("resource").some((entry) => /\/dist\/dialog-/.test(entry.name)),
  );
}

const sent = (page: Page) =>
  page.evaluate(() => (window as unknown as Mounted).reports.at(-1) as unknown as Sent);

test.beforeEach(async ({ page }) => {
  await page.goto("/widget/capture.html");
});

test("a folded draft comes back after a page load, whole: screenshots, marks, page facts, note and category", async ({
  page,
}) => {
  const categories = [
    { id: "bug", label: "Bug" },
    { id: "idea", label: "Idea" },
  ];
  await mount(page, { categories });
  await trigger(page).click();
  await stroke(page);
  await note(page).fill("Kept across a load");
  await page.getByRole("combobox", { name: "Type" }).selectOption("idea");
  await button(page, "Add screenshot").click();
  await page.evaluate(() => scrollTo(0, 400));
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(400);
  await button(page, "Capture this view").click();
  await expect(button(page, "Screenshot 2")).toBeVisible();
  await stroke(page, 0.3);
  await stroke(page, 0.6);
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeVisible();
  await expect.poll(() => stored(page)).toBe(1);

  await load(page, { categories });
  await expect(bar(page)).toContainText("Feedback draft · 2");
  expect(await events(page)).toEqual(["open"]);
  await expect(trigger(page)).toBeHidden();
  // It comes back folded: no dialog, the page scrolls, and the focus stays with the page.
  await expect(dialog(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await button(page, "Open").click();
  await expect(note(page)).toHaveValue("Kept across a load");
  await expect(page.getByRole("combobox", { name: "Type" })).toHaveValue("idea");
  await expect(page.getByRole("button", { name: /^Screenshot \d$/ })).toHaveCount(2);
  await button(page, "Send").click();
  await finish(page);
  const report = await sent(page);
  expect(report.note).toBe("Kept across a load");
  expect(report.category).toBe("idea");
  expect(report.screenshots.map((shot) => shot.marks.length)).toEqual([1, 2]);
  expect(report.screenshots.map((shot) => shot.scroll.y)).toEqual([0, 400]);
  const shown = await page.evaluate(() => ({
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
  }));
  for (const shot of report.screenshots)
    expect({ title: shot.page.title, viewport: shot.viewport }).toEqual(shown);
  expect(report.screenshots.map((shot) => new URL(shot.page.url).pathname)).toEqual([
    "/widget/capture.html",
    "/widget/capture.html",
  ]);
  // Each image came back with its own marks painted in: one stroke, then two.
  const counts = [];
  for (const index of [0, 1]) {
    counts.push((await read(page, [], [0xe5, 0x24, 0x3b], false, index))?.counted ?? 0);
    // The page itself came back too: the fixed green corner, 160 CSS pixels square.
    const corner = (await read(page, [], [0x65, 0xff, 0x6b], false, index))?.counted ?? 0;
    expect(corner, `corner of screenshot ${index + 1}`).toBeGreaterThan(160 * 150);
  }
  expect(counts[0]).toBeGreaterThan(30);
  expect(counts[1]).toBeGreaterThan(counts[0] ?? 0);
  // Sent: nothing of it stays on the device, and the next load shows no bar.
  await expect.poll(() => stored(page)).toBe(0);
  await load(page);
  await expect(trigger(page)).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});

test("Discard, Cancel and close() leave nothing on the device", async ({ page }) => {
  for (const end of ["Discard", "Cancel", "close"] as const) {
    await mount(page);
    await trigger(page).click();
    await expect(image(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect.poll(() => stored(page)).toBe(1);
    if (end === "Discard") await button(page, "Discard").click();
    if (end === "Cancel") {
      await button(page, "Open").click();
      await button(page, "Cancel").click();
    }
    if (end === "close") await page.evaluate(() => (window as unknown as Mounted).vf.close());
    await expect.poll(() => stored(page), end).toBe(0);
    await load(page);
    expect(await dialogLoaded(page), end).toBe(false);
    await expect(bar(page), end).toHaveCount(0);
    await expect(trigger(page), end).toBeVisible();
    await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  }
});

test('draft: "memory" keeps nothing on the device, so a load ends the draft', async ({ page }) => {
  await mount(page, { draft: "memory" });
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeVisible();
  await page.waitForTimeout(500);
  // Asked before stored(), which would make the database itself.
  const device = await page.evaluate(async () => ({
    databases: (await indexedDB.databases()).map((db) => db.name),
    session: Object.keys(sessionStorage),
    local: Object.keys(localStorage),
    keepCode: performance
      .getEntriesByType("resource")
      .some((entry) => /\/dist\/keep-/.test(entry.name)),
  }));
  expect(device).toEqual({ databases: [], session: [], local: [], keepCode: false });
  await load(page, { draft: "memory" });
  expect(await dialogLoaded(page)).toBe(false);
  await expect(bar(page)).toHaveCount(0);
});

test("another tab does not get this tab's draft", async ({ page, context }) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => stored(page)).toBe(1);
  const other = await context.newPage();
  await other.goto("/widget/capture.html");
  await mount(other);
  await expect(other.getByRole("button", { name: "Send feedback" })).toBeVisible();
  // Nothing kept in that tab: its dialog code is not even fetched, so no bar can come late.
  expect(await dialogLoaded(other)).toBe(false);
  await expect(other.getByRole("region", { name: "Feedback draft" })).toHaveCount(0);
});

test("a draft older than a day does not come back, and is let go", async ({ page }) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => stored(page)).toBe(1);
  // Back-dated, as if the tab had kept it two days ago.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.open("visual-feedback", 1);
        request.onsuccess = () => {
          const store = request.result.transaction("drafts", "readwrite").objectStore("drafts");
          const cursors = store.openCursor();
          cursors.onsuccess = () => {
            const cursor = cursors.result;
            if (!cursor) return resolve();
            cursor.update({ ...cursor.value, saved: Date.now() - 2 * 86_400_000 });
            cursor.continue();
          };
        };
      }),
  );
  await load(page);
  await expect(trigger(page)).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  await expect.poll(() => stored(page)).toBe(0);
  expect(await events(page)).toEqual([]);
});

test("a brought-back draft keeps going: fold, load again, and it is still there", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await note(page).fill("Twice");
  await page.keyboard.press("Escape");
  await expect.poll(() => stored(page)).toBe(1);
  await load(page);
  await button(page, "Open").click();
  await note(page).fill("Twice, edited");
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeVisible();
  // The note is written again at the fold.
  await expect.poll(() => storedNote(page)).toBe("Twice, edited");
  await load(page);
  await button(page, "Open").click();
  await expect(note(page)).toHaveValue("Twice, edited");
  expect(await stored(page)).toBe(1);
});

test("every kind of mark comes back, painted in, and Undo starts after them", async ({ page }) => {
  await mount(page, { capture: { type: "image/png" } });
  await trigger(page).click();
  await stroke(page, 0.2);
  for (const [tool, y] of [
    ["Box", 0.4],
    ["Arrow", 0.6],
  ] as const) {
    await button(page, tool).click();
    await stroke(page, y);
  }
  await button(page, "Text").click();
  const box = await image(page).boundingBox();
  if (!box) throw new Error("no image");
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.8);
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("Here");
  await page.keyboard.press("Enter");
  await note(page).fill("Kinds");
  const painted = () =>
    image(page).evaluate((canvas: HTMLCanvasElement) => {
      const data =
        canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data ?? [];
      let red = 0;
      for (let i = 0; i < data.length; i += 4) {
        if ((data[i] ?? 0) > 180 && (data[i + 1] ?? 0) < 90 && (data[i + 2] ?? 0) < 110) red++;
      }
      return red;
    });
  const before = await painted();
  expect(before).toBeGreaterThan(200);
  await page.keyboard.press("Escape");
  await expect.poll(() => stored(page)).toBe(1);
  await load(page, { capture: { type: "image/png" } });
  await button(page, "Open").click();
  await expect(note(page)).toHaveValue("Kinds");
  // The same marks, painted the same, and none of them for Undo to take back.
  expect(await painted()).toBe(before);
  await expect(button(page, "Undo")).toBeDisabled();
  await expect(button(page, "Clear")).toBeEnabled();
  await button(page, "Send").click();
  await finish(page);
  expect((await sent(page)).screenshots[0]?.marks.map((mark) => mark.tool)).toEqual([
    "pen",
    "box",
    "arrow",
    "text",
  ]);
});

test("destroy(), as at a route change, keeps a folded draft for the next widget of the page", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await note(page).fill("Kept across a route");
  await page.keyboard.press("Escape");
  await expect.poll(() => storedNote(page)).toBe("Kept across a route");
  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  await expect(page.locator("visual-feedback")).toHaveCount(0);
  expect(await stored(page)).toBe(1);
  await mount(page);
  await expect(bar(page)).toBeVisible();
  expect(await events(page)).toEqual(["open"]);
  await button(page, "Open").click();
  await expect(note(page)).toHaveValue("Kept across a route");
});

test("destroy() with the dialog open keeps the draft as it is, marks and note included", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await stroke(page);
  await note(page).fill("Never folded");
  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  // Straight away, as a route's next component would: the write may still be under way.
  await mount(page);
  await expect(bar(page)).toBeVisible();
  await button(page, "Open").click();
  await expect(note(page)).toHaveValue("Never folded");
  await button(page, "Send").click();
  await finish(page);
  expect((await sent(page)).screenshots.map((shot) => shot.marks.length)).toEqual([1]);
  await expect.poll(() => stored(page)).toBe(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
});

test("an element the host removes keeps its draft: no close fires, and the next widget brings it back", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await note(page).fill("Removed with the route");
  await page.evaluate(() => document.querySelector("visual-feedback")?.remove());
  // Kept, not ended: no close.
  await expect.poll(() => storedNote(page)).toBe("Removed with the route");
  expect(await events(page)).toEqual(["open"]);
  await mount(page);
  await expect(bar(page)).toBeVisible();
  await button(page, "Open").click();
  await expect(note(page)).toHaveValue("Removed with the route");
});

test("close() still ends the draft, and a removal after a Send keeps nothing", async ({ page }) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => stored(page)).toBe(1);
  await page.evaluate(() => (window as unknown as Mounted).vf.close());
  await expect.poll(() => stored(page)).toBe(0);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await note(page).fill("Sent");
  await button(page, "Send").click();
  await expect(page.getByRole("status")).toHaveText("Thanks, it's sent.");
  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  expect(await stored(page)).toBe(0);
});

test("of two widgets with one tag, the first owns the kept draft; the second keeps its own in memory", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(async () => {
    const { createFeedback } = await import("/dist/index.mjs" as string);
    (window as unknown as { second: unknown }).second = createFeedback({
      onSubmit: async () => {},
      position: "top-left",
    });
  });
  const triggers = page.getByRole("button", { name: "Send feedback" });
  await expect(triggers).toHaveCount(2);
  await triggers.first().click();
  await expect(image(page)).toBeVisible();
  await note(page).fill("First widget");
  await page.keyboard.press("Escape");
  await expect.poll(() => storedNote(page)).toBe("First widget");
  // The second folds its own draft: it must not take the first one's place.
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(image(page)).toBeVisible();
  await note(page).fill("Second widget");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Feedback draft" })).toHaveCount(2);
  await page.waitForTimeout(500);
  expect(await stored(page)).toBe(1);
  expect(await storedNote(page)).toBe("First widget");
  await page.reload();
  await mount(page);
  await page.evaluate(async () => {
    const { createFeedback } = await import("/dist/index.mjs" as string);
    createFeedback({ onSubmit: async () => {}, position: "top-left" });
  });
  // Only the owner, the first, in the bottom-right corner, brings it back.
  const back = page.getByRole("region", { name: "Feedback draft" });
  await expect(back).toHaveCount(1);
  const box = await back.boundingBox();
  expect((box?.x ?? 0) > (page.viewportSize()?.width ?? 0) / 2).toBe(true);
});

test("a widget made after the owner was destroyed owns the tag, so a StrictMode remount restores", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => stored(page)).toBe(1);
  await page.reload();
  // StrictMode in development: create, destroy at once, create again.
  await page.evaluate(async () => {
    const { createFeedback } = await import("/dist/index.mjs" as string);
    createFeedback({ onSubmit: async () => {} }).destroy();
  });
  await mount(page);
  await expect(bar(page)).toBeVisible();
  await expect(page.getByRole("region", { name: "Feedback draft" })).toHaveCount(1);
});

test("a kept category the host no longer offers falls back to the first one", async ({ page }) => {
  await mount(page, {
    categories: [
      { id: "idea", label: "Idea" },
      { id: "old", label: "Old" },
    ],
  });
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.getByRole("combobox", { name: "Type" }).selectOption("old");
  await page.keyboard.press("Escape");
  await expect.poll(() => stored(page)).toBe(1);
  await load(page, {
    categories: [
      { id: "bug", label: "Bug" },
      { id: "idea", label: "Idea" },
    ],
  });
  await button(page, "Open").click();
  await expect(page.getByRole("combobox", { name: "Type" })).toHaveValue("bug");
});

test("close() while a kept draft is still coming back fires no error and leaves the widget usable", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => stored(page)).toBe(1);
  await page.reload();
  // The dialog's code arrives late, so close() lands while the draft is coming back.
  await page.route("**/dist/dialog-*.mjs", async (route) => {
    await new Promise((done) => setTimeout(done, 400));
    await route.continue();
  });
  await mount(page);
  await page.evaluate(() => {
    const w = window as unknown as Mounted & { errors: number };
    w.errors = 0;
    w.vf.on("error", () => w.errors++);
    w.vf.close();
  });
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as unknown as { errors: number }).errors)).toBe(0);
  await expect(bar(page)).toHaveCount(0);
  await expect(trigger(page)).toBeVisible();
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
});

/** Back-dates every kept draft, as if its tab had kept it two days ago. */
const age = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.open("visual-feedback", 1);
        request.onsuccess = () => {
          const store = request.result.transaction("drafts", "readwrite").objectStore("drafts");
          const cursors = store.openCursor();
          cursors.onsuccess = () => {
            const cursor = cursors.result;
            if (!cursor) return resolve();
            cursor.update({ ...cursor.value, saved: Date.now() - 2 * 86_400_000 });
            cursor.continue();
          };
        };
      }),
  );

test("another tab's open lets go of a draft a closed tab left a day ago, and not of a fresh one", async ({
  page,
  context,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => stored(page)).toBe(1);
  await page.close();
  const other = await context.newPage();
  await other.goto("/widget/capture.html");
  await mount(other);
  // A fresh draft of a closed tab stays when this tab's widget opens.
  await other.getByRole("button", { name: "Send feedback" }).click();
  await expect(other.getByRole("textbox", { name: "Your note" })).toBeVisible();
  await other.waitForTimeout(300);
  expect(await stored(other)).toBe(1);
  await other.getByRole("button", { name: "Cancel" }).click();
  // A day later, the next open lets it go.
  await age(other);
  await other.getByRole("button", { name: "Send feedback" }).click();
  await expect(other.getByRole("textbox", { name: "Your note" })).toBeVisible();
  await expect.poll(() => stored(other)).toBe(0);
});

test('a page with draft: "memory" neither brings back nor deletes a draft an earlier page kept', async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => stored(page)).toBe(1);
  await load(page, { draft: "memory" });
  expect(await dialogLoaded(page)).toBe(false);
  await expect(bar(page)).toHaveCount(0);
  expect(await stored(page)).toBe(1);
  // A later page that keeps drafts brings it back.
  await load(page);
  await expect(bar(page)).toBeVisible();
});

test("a load brings back the draft as it was last folded, not edits made after Open", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await note(page).fill("Folded");
  await page.keyboard.press("Escape");
  await expect.poll(() => storedNote(page)).toBe("Folded");
  await button(page, "Open").click();
  await note(page).fill("Not folded");
  await load(page);
  await button(page, "Open").click();
  await expect(note(page)).toHaveValue("Folded");
});

test("close() in the moment a load brings a draft back leaves it kept, as SPEC says", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => stored(page)).toBe(1);
  await page.reload();
  await page.route("**/dist/dialog-*.mjs", async (route) => {
    await new Promise((done) => setTimeout(done, 400));
    await route.continue();
  });
  await mount(page);
  await page.evaluate(() => (window as unknown as Mounted).vf.close());
  await page.waitForTimeout(1000);
  expect(await stored(page)).toBe(1);
  await page.unroute("**/dist/dialog-*.mjs");
  await load(page);
  await expect(bar(page)).toBeVisible();
});

test("a sent draft leaves the device at once: a load during the thank-you brings nothing back", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => stored(page)).toBe(1);
  await button(page, "Open").click();
  await note(page).fill("Sent from a kept draft");
  await button(page, "Send").click();
  await expect(page.getByRole("status")).toHaveText("Thanks, it's sent.");
  await expect.poll(() => stored(page)).toBe(0);
  // Still inside the 3 s the thank-you stays: the dialog has not closed yet.
  await expect(page.getByRole("status")).toBeVisible();
  await load(page);
  expect(await dialogLoaded(page)).toBe(false);
  await expect(bar(page)).toHaveCount(0);
});

/** Holds the dialog's code back, so a call lands while the widget is still opening. */
const slowDialog = (page: Page) =>
  page.route("**/dist/dialog-*.mjs", async (route) => {
    await new Promise((done) => setTimeout(done, 400));
    await route.continue();
  });

test("an open() made while opening does nothing once close() ran in between", async ({ page }) => {
  await slowDialog(page);
  await mount(page);
  await page.evaluate(async () => {
    const { vf } = window as unknown as Mounted;
    void vf.open().catch(() => {});
    const queued = vf.open();
    vf.close();
    await queued;
  });
  await page.waitForTimeout(800);
  await expect(dialog(page)).toHaveCount(0);
  expect(await events(page)).not.toContain("open");
});

test("an open() made while a gone draft was looked for still opens a capture", async ({ page }) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => stored(page)).toBe(1);
  await age(page);
  await page.reload();
  await slowDialog(page);
  await mount(page);
  await page.evaluate(() => (window as unknown as Mounted).vf.open());
  await expect(image(page)).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});

test("a fold that cannot be written lets go of the earlier one, so a load never brings back an older draft", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await note(page).fill("First fold");
  await page.keyboard.press("Escape");
  await expect.poll(() => storedNote(page)).toBe("First fold");
  await button(page, "Open").click();
  await note(page).fill("Second fold");
  // Storage full from now on.
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
  });
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeVisible();
  await expect.poll(() => stored(page)).toBe(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  await load(page);
  await expect(bar(page)).toHaveCount(0);
});

test("a Send while an earlier fold is still being written keeps nothing on the device", async ({
  page,
}) => {
  // The first PNG encode is the draft's own copy of the screenshot: it is held.
  await page.evaluate(() => {
    const w = window as unknown as { letGo: () => void; written: number };
    w.written = 0;
    const held = new Promise<void>((done) => {
      w.letGo = done;
    });
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    let first = true;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (type !== "image/png" || !first) return toBlob.call(this, callback, type, quality);
      first = false;
      void held.then(() =>
        toBlob.call(
          this,
          (blob) => {
            callback(blob);
            w.written++;
          },
          type,
          quality,
        ),
      );
    };
  });
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await button(page, "Open").click();
  await note(page).fill("Sent while the fold was written");
  await button(page, "Send").click();
  await expect(page.getByRole("status")).toHaveText("Thanks, it's sent.");
  await page.evaluate(() => (window as unknown as { letGo: () => void }).letGo());
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { written: number }).written))
    .toBe(1);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  expect(await stored(page)).toBe(0);
});

test("close() after the dialog is in, while a load still reads the draft back, keeps it", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => stored(page)).toBe(1);
  await page.reload();
  // The dialog is in at once; the code that reads the draft arrives late.
  await page.route("**/dist/keep-*.mjs", async (route) => {
    await new Promise((done) => setTimeout(done, 600));
    await route.continue();
  });
  await mount(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .some((entry) => /\/dist\/dialog-/.test(entry.name)),
      ),
    )
    .toBe(true);
  await page.evaluate(() => (window as unknown as Mounted).vf.close());
  await page.waitForTimeout(1000);
  await expect(bar(page)).toHaveCount(0);
  expect(await stored(page)).toBe(1);
  await page.unroute("**/dist/keep-*.mjs");
  await load(page);
  await expect(bar(page)).toBeVisible();
});

test("storage that throws at load leaves the widget working, with the draft in memory", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  await page.reload();
  await mount(page);
  await expect(trigger(page)).toBeVisible();
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeVisible();
  await button(page, "Open").click();
  await expect(image(page)).toBeVisible();
});

test("a widget made while the removed one still writes the draft waits for it, and brings it back", async ({
  page,
}) => {
  // The first PNG encode, the draft's own copy of the screenshot, is held until let go.
  await page.evaluate(() => {
    const w = window as unknown as { letGo: () => void };
    const held = new Promise<void>((done) => {
      w.letGo = done;
    });
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    let first = true;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (type !== "image/png" || !first) return toBlob.call(this, callback, type, quality);
      first = false;
      void held.then(() => toBlob.call(this, callback, type, quality));
    };
  });
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await note(page).fill("Written late");
  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  await mount(page);
  // The new widget is reading the draft back while the old one cannot finish writing it.
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as unknown as { letGo: () => void }).letGo());
  await expect(bar(page)).toBeVisible();
  await button(page, "Open").click();
  await expect(note(page)).toHaveValue("Written late");
});

test("a click with a draft still kept in this tab opens that draft, not a new capture", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await note(page).fill("Kept, then clicked");
  await page.keyboard.press("Escape");
  await expect.poll(() => storedNote(page)).toBe("Kept, then clicked");
  await page.reload();
  // close() while the load brings it back: the draft stays kept, and the trigger shows.
  await page.route("**/dist/dialog-*.mjs", async (route) => {
    await new Promise((done) => setTimeout(done, 400));
    await route.continue();
  });
  await mount(page);
  await page.evaluate(() => (window as unknown as Mounted).vf.close());
  await page.unroute("**/dist/dialog-*.mjs");
  await expect(trigger(page)).toBeVisible();
  await trigger(page).click();
  await expect(note(page)).toHaveValue("Kept, then clicked");
  await expect(dialog(page)).toBeVisible();
  expect(await stored(page)).toBe(1);
});

test("a second widget ending its own draft leaves the owner's kept draft alone", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(async () => {
    const { createFeedback } = await import("/dist/index.mjs" as string);
    createFeedback({ onSubmit: async () => {}, position: "top-left" });
  });
  await page.getByRole("button", { name: "Send feedback" }).first().click();
  await expect(image(page)).toBeVisible();
  await note(page).fill("Owner");
  await page.keyboard.press("Escape");
  await expect.poll(() => storedNote(page)).toBe("Owner");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Discard", exact: true }).last().click();
  await expect(page.getByRole("region", { name: "Feedback draft" })).toHaveCount(1);
  await page.waitForTimeout(300);
  expect(await storedNote(page)).toBe("Owner");
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toHaveLength(1);
});

test("destroy() while a load still reads the draft back, the dialog already in, keeps it", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await note(page).fill("Read back late");
  await page.keyboard.press("Escape");
  await expect.poll(() => storedNote(page)).toBe("Read back late");
  await page.reload();
  await page.route("**/dist/keep-*.mjs", async (route) => {
    await new Promise((done) => setTimeout(done, 600));
    await route.continue();
  });
  await mount(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .some((entry) => /\/dist\/dialog-/.test(entry.name)),
      ),
    )
    .toBe(true);
  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  await page.waitForTimeout(1200);
  expect(await storedNote(page)).toBe("Read back late");
  expect(await events(page)).not.toContain("close");
  await page.unroute("**/dist/keep-*.mjs");
  await mount(page);
  await expect(bar(page)).toBeVisible();
});

test("when the owner leaves, a widget already in the page takes over and opens the kept draft", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(async () => {
    const { createFeedback } = await import("/dist/index.mjs" as string);
    createFeedback({ onSubmit: async () => {}, position: "top-left" });
  });
  await page.getByRole("button", { name: "Send feedback" }).first().click();
  await expect(image(page)).toBeVisible();
  await note(page).fill("From the owner");
  await page.keyboard.press("Escape");
  await expect.poll(() => storedNote(page)).toBe("From the owner");
  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(note(page)).toHaveValue("From the owner");
});

test('a draft: "memory" widget made first does not stop the next one from keeping its draft', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { createFeedback } = await import("/dist/index.mjs" as string);
    createFeedback({ onSubmit: async () => {}, position: "top-left", draft: "memory" });
  });
  await mount(page);
  await page.getByRole("button", { name: "Send feedback" }).last().click();
  await expect(image(page)).toBeVisible();
  await note(page).fill("Kept by the second");
  await page.keyboard.press("Escape");
  await expect.poll(() => storedNote(page)).toBe("Kept by the second");
});

test("destroy() after Send was handed to the host keeps nothing, so the next widget cannot send it twice", async ({
  page,
}) => {
  await page.evaluate(() => {
    const w = window as unknown as Mounted;
    w.hold = new Promise((resolve) => {
      w.release = resolve;
    });
  });
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await note(page).fill("Under way");
  await page.keyboard.press("Escape");
  await expect.poll(() => storedNote(page)).toBe("Under way");
  await button(page, "Open").click();
  await button(page, "Send").click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Mounted).reports.length))
    .toBe(1);
  await page.evaluate(() => {
    const w = window as unknown as Mounted;
    // On before destroy(): a late sent or error would land in the same list, after close.
    const list = w.events;
    w.vf.on("sent", () => list.push("sent"));
    w.vf.on("error", () => list.push("error"));
    w.vf.destroy();
  });
  // Not kept, so it ended: close fires.
  expect(await events(page)).toEqual(["open", "close"]);
  await expect.poll(() => stored(page)).toBe(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  // The destroyed widget's own list: mount() gives the next widget a new one.
  await page.evaluate(() => {
    const w = window as unknown as Mounted & { before: string[] };
    w.before = w.events;
  });
  await mount(page);
  await page.waitForTimeout(500);
  await expect(bar(page)).toHaveCount(0);
  await page.evaluate(() => (window as unknown as Mounted).release?.());
  await page.waitForTimeout(300);
  // close stays the last event of the destroyed widget: no sent after it.
  expect(await page.evaluate(() => (window as unknown as { before: string[] }).before)).toEqual([
    "open",
    "close",
  ]);
});

test("open() from idle with a kept id whose draft is gone starts a new capture", async ({
  page,
}) => {
  await mount(page, { trigger: "none" });
  await page.evaluate(() => sessionStorage.setItem("visual-feedback:visual-feedback", "gone"));
  await page.evaluate(() => (window as unknown as Mounted).vf.open());
  await expect(image(page)).toBeVisible();
  await expect(note(page)).toHaveValue("");
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
});

test("a widget that takes over folds its own draft in memory, and never over the one still kept", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(async () => {
    const { createFeedback } = await import("/dist/index.mjs" as string);
    createFeedback({ onSubmit: async () => {}, position: "top-left" });
  });
  await page.getByRole("button", { name: "Send feedback" }).first().click();
  await expect(image(page)).toBeVisible();
  await note(page).fill("Kept by the owner");
  await page.keyboard.press("Escape");
  await expect.poll(() => storedNote(page)).toBe("Kept by the owner");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(image(page)).toBeVisible();
  await note(page).fill("The second's own");
  // The owner leaves while the second's dialog is open; its fold must not replace the kept one.
  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeVisible();
  await page.waitForTimeout(500);
  expect(await stored(page)).toBe(1);
  expect(await storedNote(page)).toBe("Kept by the owner");
  // Still named by this tab's key, so a load brings it back.
  await load(page);
  await expect(bar(page)).toBeVisible();
  await button(page, "Open").click();
  await expect(note(page)).toHaveValue("Kept by the owner");
});

/** A second widget of the default tag, whose events are recorded as `window.second`. */
const second = (page: Page, options: Record<string, unknown> = {}) =>
  page.evaluate(async (options) => {
    const { createFeedback } = await import("/dist/index.mjs" as string);
    const w = window as unknown as { second: { vf: Mounted["vf"]; events: string[] } };
    const vf = createFeedback({ onSubmit: async () => {}, position: "top-left", ...options });
    w.second = { vf, events: [] };
    vf.on("open", () => w.second.events.push("open"));
    vf.on("close", () => w.second.events.push("close"));
  }, options);

const secondEvents = (page: Page) =>
  page.evaluate(() => (window as unknown as { second: { events: string[] } }).second.events);

test("a second widget that became the owner, cancelling its own draft, leaves the kept one alone", async ({
  page,
}) => {
  await mount(page);
  await second(page);
  await page.getByRole("button", { name: "Send feedback" }).first().click();
  await expect(image(page)).toBeVisible();
  await note(page).fill("Kept by the first");
  await page.keyboard.press("Escape");
  await expect.poll(() => storedNote(page)).toBe("Kept by the first");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(image(page)).toBeVisible();
  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  await button(page, "Cancel").click();
  await expect(dialog(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await storedNote(page)).toBe("Kept by the first");
  await load(page);
  await expect(bar(page)).toBeVisible();
});

test("destroy() of a widget that does not own its tag ends its draft: close fires", async ({
  page,
}) => {
  await mount(page);
  await second(page);
  await page.getByRole("button", { name: "Send feedback" }).last().click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    (window as unknown as { second: { vf: Mounted["vf"] } }).second.vf.destroy(),
  );
  expect(await secondEvents(page)).toEqual(["open", "close"]);
  expect(await stored(page)).toBe(0);
});

test("a folded draft that is no longer kept ends at destroy(): close fires, and its record goes", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect.poll(() => stored(page)).toBe(1);
  await page.evaluate(() => (window as unknown as Mounted).vf.update({ draft: "memory" }));
  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  expect(await events(page)).toEqual(["open", "close"]);
  await expect.poll(() => stored(page)).toBe(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
});

test('with draft: "memory", destroy() of a folded draft fires close; an idle widget fires nothing', async ({
  page,
}) => {
  await mount(page, { draft: "memory" });
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar(page)).toBeVisible();
  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  expect(await events(page)).toEqual(["open", "close"]);
  await mount(page);
  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  expect(await events(page)).toEqual([]);
});

test("destroy() in the middle of a stroke keeps that stroke, as a fold would", async ({ page }) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await note(page).fill("Drawn while the route changed");
  const box = await image(page).boundingBox();
  if (!box) throw new Error("no image");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 6 });
  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  await page.mouse.up();
  await mount(page);
  await expect(bar(page)).toBeVisible();
  await button(page, "Open").click();
  await expect(note(page)).toHaveValue("Drawn while the route changed");
  await button(page, "Send").click();
  await finish(page);
  const [mark] = (await sent(page)).screenshots[0]?.marks ?? [];
  expect(mark?.tool).toBe("pen");
  expect((mark as unknown as { points: unknown[] }).points.length).toBeGreaterThanOrEqual(2);
});

test("destroy() while a label is still being typed keeps that label", async ({ page }) => {
  await mount(page);
  await trigger(page).click();
  await expect(image(page)).toBeVisible();
  await button(page, "Text").click();
  const box = await image(page).boundingBox();
  if (!box) throw new Error("no image");
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await page.keyboard.type("Typed, never committed");
  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  await mount(page);
  await expect(bar(page)).toBeVisible();
  await button(page, "Open").click();
  await note(page).fill("Sent");
  await button(page, "Send").click();
  await finish(page);
  const [mark] = (await sent(page)).screenshots[0]?.marks ?? [];
  expect(mark).toMatchObject({ tool: "text", text: "Typed, never committed" });
});
