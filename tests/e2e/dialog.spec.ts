import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { events, focused, type Mounted, mount, withoutSupport } from "./widget";

const trigger = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Send feedback" });

test.beforeEach(async ({ page }) => {
  await page.goto("/widget/");
});

test("the trigger is a named round icon button in the chosen corner, and none draws nothing", async ({
  page,
}) => {
  await mount(page);
  const box = await trigger(page).boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport).toBeTruthy();
  if (!box || !viewport) return;
  expect(box.height).toBe(40);
  expect(box.width).toBe(40);
  expect(Math.round(viewport.width - box.x - box.width)).toBe(16);
  expect(Math.round(viewport.height - box.y - box.height)).toBe(16);
  await expect(trigger(page)).toHaveText("");
  await expect(trigger(page)).toHaveCSS("border-top-left-radius", "999px");

  for (const position of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
    await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
    await mount(page, { position });
    const corner = await trigger(page).boundingBox();
    const [y, x] = position.split("-");
    const [left, top] = [corner?.x ?? -1, corner?.y ?? -1];
    const fromX = x === "left" ? left : viewport.width - left - (corner?.width ?? 0);
    const fromY = y === "top" ? top : viewport.height - top - (corner?.height ?? 0);
    expect(Math.round(fromX), position).toBe(16);
    expect(Math.round(fromY), position).toBe(16);
  }

  await page.evaluate(() => (window as unknown as Mounted).vf.destroy());
  await mount(page, { trigger: "none" });
  await expect(page.locator("visual-feedback")).toHaveCount(1);
  await expect(trigger(page)).toHaveCount(0);
  await page.evaluate(() => (window as unknown as Mounted).vf.open());
  await expect(page.getByRole("dialog", { name: "Send feedback" })).toBeVisible();
});

test("the dialog traps focus, Escape keeps a draft, Discard closes, and focus goes back to the trigger", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.getByText("Esc keeps it as a draft", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Your note" })).toBeFocused();

  const seen: string[] = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    seen.push(await focused(page));
  }
  // Undo and Clear are disabled while there are no marks, so Tab skips them.
  expect(seen).toEqual(["send", "send-more", "minimise", "cancel", "tool", "tool", "tool", "tool"]);
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Arrow", exact: true })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const bar = page.getByRole("region", { name: "Feedback draft" });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button", { name: "Capture this view" })).toBeFocused();
  await expect(trigger(page)).toBeHidden();
  expect(await events(page)).toEqual(["open"]);
  await bar.getByRole("button", { name: "Discard" }).click();
  await expect(bar).toHaveCount(0);
  expect(await focused(page)).toBe("trigger");
  expect(await events(page)).toEqual(["open", "close"]);
});

test("the keyboard alone can write the note and cancel", async ({ page }) => {
  await mount(page);
  await trigger(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Your note" })).toBeFocused();
  await page.keyboard.type("Typed with keys");
  await expect(page.getByRole("textbox", { name: "Your note" })).toHaveValue("Typed with keys");
  // Past Send and its menu caret, the focus wraps to the header: Keep as draft, then Cancel.
  for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  // The note would be lost, so Cancel asks; Shift+Tab goes back through Keep as draft to Discard.
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("group", { name: "Discard this feedback?" }).getByRole("button", {
      name: "Keep as draft",
    }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Discard", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await events(page)).toEqual(["open", "close"]);
});

test("focus goes back to where it was when open() was called", async ({ page }) => {
  await mount(page, { trigger: "none" });
  await page.locator("#page-button").focus();
  await page.evaluate(() => (window as unknown as Mounted).vf.open());
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await focused(page)).toBe("page-button");
  expect(await events(page)).toEqual(["open", "close"]);
});

test("the page does not scroll while the dialog is open", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    document.documentElement.style.overflow = "scroll";
    window.scrollTo(0, 300);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300);
  await trigger(page).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.mouse.move(20, 20);
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.scrollY)).toBe(300);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("scroll");
  // WebKit can take one wheel before it applies the restored overflow, so the wheel repeats.
  await expect
    .poll(async () => {
      await page.mouse.wheel(0, 400);
      return page.evaluate(() => window.scrollY);
    })
    .toBeGreaterThan(300);
});

test("open and close fire once each, and an unsubscribed handler does not", async ({ page }) => {
  await mount(page);
  await page.evaluate(async () => {
    const w = window as unknown as Mounted;
    const off = w.vf.on("open", () => w.events.push("removed"));
    off();
    const first = w.vf.open();
    await w.vf.open();
    w.events.push(
      document.querySelector("visual-feedback")?.shadowRoot?.querySelector("dialog")?.open
        ? "shown"
        : "not shown",
    );
    await first;
    await w.vf.open();
    w.vf.close();
    w.vf.close();
  });
  expect(await events(page)).toEqual(["open", "shown", "close"]);
});

test("destroy() removes everything, restores the page and makes later calls do nothing", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => (window as unknown as Mounted).vf.open());
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
  await page.evaluate(async () => {
    const w = window as unknown as Mounted;
    w.vf.destroy();
    w.vf.destroy();
    w.vf.on("open", () => w.events.push("late"));
    await w.vf.open();
    w.vf.close();
  });
  await expect(page.locator("visual-feedback")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  // The draft stays kept for the next widget, so it did not end: no close.
  expect(await events(page)).toEqual(["open"]);
});

function withoutAdoptedStyleSheets(): void {
  delete (Document.prototype as Partial<Document>).adoptedStyleSheets;
  delete (ShadowRoot.prototype as Partial<ShadowRoot>).adoptedStyleSheets;
}

for (const [name, script, arg] of [
  ["adoptedStyleSheets", withoutAdoptedStyleSheets, ""],
  ["color-mix()", withoutSupport, "color-mix"],
] as const) {
  test(`below the floor (no ${name}) nothing renders and nothing logs`, async ({ page }) => {
    const logged: string[] = [];
    page.on("console", (message) => logged.push(message.text()));
    page.on("pageerror", (error) => logged.push(error.message));
    await page.addInitScript(script, arg);
    await page.goto("/widget/");
    expect(
      await page.evaluate(
        () =>
          !("adoptedStyleSheets" in Document.prototype) ||
          !CSS.supports("color", "color-mix(in srgb, red, red)"),
      ),
    ).toBe(true);
    await mount(page);
    await page.evaluate(() => (window as unknown as Mounted).vf.open());
    await expect(page.locator("visual-feedback")).toHaveCount(0);
    await page.evaluate(() => {
      const w = window as unknown as Mounted;
      w.vf.close();
      w.vf.destroy();
    });
    expect(await events(page)).toEqual([]);
    expect(logged).toEqual([]);
  });
}

test("axe passes with the dialog open, and reaches inside the shadow root", async ({ page }) => {
  await mount(page);
  await trigger(page).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const axe = () =>
    new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);

  const clean = await axe().analyze();
  expect(clean.violations.map((v) => v.id)).toEqual([]);
  const inShadow = clean.passes
    .flatMap((rule) => rule.nodes)
    .map((node) => JSON.stringify(node.target))
    .filter((target) => target.startsWith('[["visual-feedback"') && /note|cancel/.test(target));
  expect(inShadow.length).toBeGreaterThan(0);

  await page.evaluate(() => {
    const planted = document.createElement("button");
    planted.className = "planted";
    document
      .querySelector("visual-feedback")
      ?.shadowRoot?.querySelector(".dialog")
      ?.append(planted);
  });
  const planted = await axe().analyze();
  const named = planted.violations.find((v) => v.id === "button-name");
  expect(JSON.stringify(named?.nodes.map((node) => node.target))).toContain("planted");
});

test("a page with * { all: unset } and button { display: none } still gets a working widget", async ({
  page,
}) => {
  await page.goto("/widget/hostile.html");
  await expect(page.getByRole("button", { name: "Hidden by the page" })).toBeHidden();
  await mount(page);
  await expect(trigger(page)).toBeVisible();
  const box = await trigger(page).boundingBox();
  const viewport = page.viewportSize();
  expect(box?.height).toBe(40);
  expect(Math.round((viewport?.width ?? 0) - (box?.x ?? 0) - (box?.width ?? 0))).toBe(16);
  expect(Math.round((viewport?.height ?? 0) - (box?.y ?? 0) - 40)).toBe(16);
  await trigger(page).click();
  const note = page.getByRole("textbox", { name: "Your note" });
  await expect(note).toBeVisible();
  await note.fill("still works");
  await expect(note).toHaveValue("still works");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The draft bar works under the same page.
  const bar = page.getByRole("region", { name: "Feedback draft" });
  await bar.getByRole("button", { name: "Open" }).click();
  await expect(note).toHaveValue("still works");
  await page.keyboard.press("Escape");
  await bar.getByRole("button", { name: "Discard" }).click();
  await expect(bar).toHaveCount(0);
  expect(await events(page)).toEqual(["open", "close"]);
});

test("under the CSP that SPEC section 11 lists, the widget opens and closes with no violation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { violations: string[] }).violations = seen;
    document.addEventListener("securitypolicyviolation", (e) => seen.push(e.effectiveDirective));
  });
  await page.route("**/widget/", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "content-security-policy":
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:",
      },
    });
  });
  await page.goto("/widget/");
  await mount(page);
  await expect(trigger(page)).toHaveCSS("border-top-left-radius", "999px");
  await trigger(page).click();
  await expect(page.getByRole("textbox", { name: "Your note" })).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCSS("background-color", "rgba(0, 0, 0, 0.45)");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const violations = () =>
    page.evaluate(() => (window as unknown as { violations: string[] }).violations);
  await page.waitForTimeout(250);
  expect(await violations()).toEqual([]);

  // Control: an inline style attribute is reported, so the listener above can see a violation.
  await page.evaluate(() => document.body.setAttribute("style", "color: red"));
  await expect.poll(violations).toContain("style-src-attr");
});

test("removing the element while the dialog loads leaves the page usable", async ({ page }) => {
  await mount(page);
  await page.evaluate(async () => {
    const w = window as unknown as Mounted;
    const opening = w.vf.open();
    document.querySelector("visual-feedback")?.remove();
    await opening;
  });
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  expect(await events(page)).toEqual([]);
});

test("createFeedback() before <body> exists still shows the trigger", async ({ page }) => {
  await page.evaluate(() => document.body.remove());
  await mount(page);
  await expect(page.getByRole("button", { name: "Send feedback" })).toBeVisible();
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByRole("dialog", { name: "Send feedback" })).toBeVisible();
});

test("the scroll lock restores longhands and priorities, also with two widgets open", async ({
  page,
}) => {
  await page.evaluate(() => {
    document.documentElement.style.setProperty("overflow-x", "clip");
    document.documentElement.style.setProperty("overflow-y", "auto", "important");
    document.body.style.overflow = "scroll";
  });
  const before = await page.evaluate(() => [
    document.documentElement.getAttribute("style"),
    document.body.getAttribute("style"),
  ]);
  await mount(page);
  await page.evaluate(async () => {
    const w = window as unknown as Mounted & { second: Mounted["vf"] };
    const { createFeedback } = await import("/dist/index.mjs" as string);
    w.second = createFeedback({ trigger: "none", tagName: "second-feedback" });
    await w.vf.open();
    await w.second.open();
  });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe(
    "hidden",
  );
  await page.evaluate(() => {
    const w = window as unknown as Mounted & { second: Mounted["vf"] };
    w.vf.close();
    w.second.close();
  });
  expect(
    await page.evaluate(() => [
      document.documentElement.getAttribute("style"),
      document.body.getAttribute("style"),
    ]),
  ).toEqual(before);
});

test("removing the element while the dialog is open closes it and unlocks the page", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => (window as unknown as Mounted).vf.open());
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
  await page.evaluate(() => document.querySelector("visual-feedback")?.remove());
  await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  // Kept for the next widget, as at a route change: the draft did not end.
  expect(await events(page)).toEqual(["open"]);
});

test("moving the element keeps the dialog open", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => (window as unknown as Mounted).vf.open());
  await page.getByRole("textbox", { name: "Your note" }).fill("draft");
  await page.evaluate(() => {
    const host = document.querySelector("visual-feedback");
    if (host) document.querySelector("main")?.append(host);
  });
  await page.waitForTimeout(100);
  await expect(page.getByRole("textbox", { name: "Your note" })).toHaveValue("draft");
  expect(await events(page)).toEqual(["open"]);
});

test("two copies of the package share one scroll lock and the removal hook", async ({ page }) => {
  await page.evaluate(() => document.documentElement.style.setProperty("overflow-y", "scroll"));
  await mount(page);
  await page.evaluate(async () => {
    const w = window as unknown as Mounted & { copy: Mounted["vf"] };
    // A query string makes the browser load a second, separate copy of the module.
    const { createFeedback } = await import("/dist/index.mjs?copy" as string);
    w.copy = createFeedback({ trigger: "none", draft: "memory" });
    w.copy.on("close", () => w.events.push("copy close"));
    await w.vf.open();
    await w.copy.open();
    w.vf.close();
  });
  expect(await page.evaluate(() => document.documentElement.style.overflowY)).toBe("hidden");
  await page.evaluate(() => document.querySelectorAll("visual-feedback")[1]?.remove());
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("style")))
    .toBe("overflow-y: scroll;");
  expect(await events(page)).toEqual(["open", "close", "copy close"]);
});

test("a throwing close handler is reported, and cannot stop destroy() from removing the widget", async ({
  page,
}) => {
  // In memory, so destroy() ends the draft and close fires.
  await mount(page, { draft: "memory" });
  const thrown = await page.evaluate(async () => {
    const w = window as unknown as Mounted;
    const reported: string[] = [];
    window.addEventListener("error", (event) => {
      reported.push(event.message);
      event.preventDefault();
    });
    w.vf.on("close", () => {
      throw new Error("host bug");
    });
    let later = false;
    w.vf.on("close", () => {
      later = true;
    });
    await w.vf.open();
    try {
      w.vf.destroy();
      return ["no throw", reported.join(), later];
    } catch (error) {
      return [(error as Error).message, reported.join(), later];
    }
  });
  expect(thrown).toEqual(["no throw", expect.stringContaining("host bug"), true]);
  await expect(page.locator("visual-feedback")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
});

test("Cancel asks before it discards a note or a mark, and Keep editing or Esc go back", async ({
  page,
}) => {
  await mount(page);
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  const cancel = page.getByRole("button", { name: "Cancel" });
  const question = page.getByRole("group", { name: "Discard this feedback?" });
  const keepEditing = page.getByRole("button", { name: "Keep editing" });
  const note = page.getByRole("textbox", { name: "Your note" });
  // Nothing made yet: Cancel closes at once.
  await trigger(page).click();
  await expect(page.locator("visual-feedback canvas.image")).toBeVisible();
  await cancel.click();
  await expect(dialog).toHaveCount(0);
  expect(await events(page)).toEqual(["open", "close"]);

  await trigger(page).click();
  await note.fill("Keep me");
  await cancel.click();
  await expect(question).toBeVisible();
  await expect(keepEditing).toBeFocused();
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(scan.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(question).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(cancel).toBeFocused();
  await cancel.click();
  await keepEditing.click();
  await expect(question).toHaveCount(0);
  await expect(cancel).toBeFocused();
  await expect(note).toHaveValue("Keep me");
  expect(await events(page)).toEqual(["open", "close", "open"]);
  await cancel.click();
  await question.getByRole("button", { name: "Discard" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Feedback draft" })).toHaveCount(0);
  expect(await events(page)).toEqual(["open", "close", "open", "close"]);

  // A mark alone is something to lose too.
  await trigger(page).click();
  const canvas = page.locator("visual-feedback canvas.image");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await cancel.click();
  await expect(question).toBeVisible();
});

test("Cancel also asks for a second screenshot or a chosen category alone; Keep as draft folds, and close() never asks", async ({
  page,
}) => {
  await mount(page, {
    categories: [
      { id: "bug", label: "Bug" },
      { id: "idea", label: "Idea" },
    ],
  });
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  const question = page.getByRole("group", { name: "Discard this feedback?" });
  const draftBar = page.getByRole("region", { name: "Feedback draft" });
  const cancel = page.getByRole("button", { name: "Cancel" });
  // A chosen category alone.
  await trigger(page).click();
  await page.getByRole("combobox", { name: "Type" }).selectOption("idea");
  await cancel.click();
  await expect(question).toBeVisible();
  // Keep as draft folds it, and nothing ends.
  await question.getByRole("button", { name: "Keep as draft" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(draftBar).toBeVisible();
  expect(await events(page)).toEqual(["open"]);
  // A second screenshot alone, with the category back to the first.
  await draftBar.getByRole("button", { name: "Capture this view" }).click();
  await expect(page.getByRole("button", { name: /^Screenshot 2/ })).toBeVisible();
  await page.getByRole("combobox", { name: "Type" }).selectOption("bug");
  await cancel.click();
  await expect(question).toBeVisible();
  await question.getByRole("button", { name: "Discard" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(draftBar).toHaveCount(0);
  // close() with a note does not ask.
  await trigger(page).click();
  await page.getByRole("textbox", { name: "Your note" }).fill("Gone");
  await page.evaluate(() => (window as unknown as Mounted).vf.close());
  await expect(dialog).toHaveCount(0);
  await expect(question).toHaveCount(0);
});

test("a label still being typed counts: a click on Cancel asks", async ({ page }) => {
  await mount(page);
  await trigger(page).click();
  const canvas = page.locator("visual-feedback canvas.image");
  await expect(canvas).toBeVisible();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  const label = page.getByRole("textbox", { name: "Text", exact: true });
  await expect(label).toBeFocused();
  await label.pressSequentially("Hi");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("group", { name: "Discard this feedback?" })).toBeVisible();
});
