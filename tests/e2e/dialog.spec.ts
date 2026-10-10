import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { events, focused, type Mounted, mount, withoutSupport } from "./widget";

const trigger = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Send feedback" });

test.beforeEach(async ({ page }) => {
  await page.goto("/widget/");
});

test("the trigger is a named pill with its text in the chosen corner, and none draws nothing", async ({
  page,
}) => {
  await mount(page);
  const box = await trigger(page).boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport).toBeTruthy();
  if (!box || !viewport) return;
  expect(box.height).toBe(40);
  expect(box.width).toBeGreaterThan(box.height);
  expect(Math.round(viewport.width - box.x - box.width)).toBe(16);
  expect(Math.round(viewport.height - box.y - box.height)).toBe(16);
  await expect(trigger(page)).toHaveText("Feedback");
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

test("the dialog traps focus, Escape cancels, and focus goes back to the trigger", async ({
  page,
}) => {
  await mount(page);
  await trigger(page).click();
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.getByText("Esc to cancel", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Your note" })).toBeFocused();

  const seen: string[] = [];
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press("Tab");
    seen.push(await focused(page));
  }
  // Undo and Clear are disabled while there are no marks, so Tab skips them.
  expect(seen).toEqual(["send", "cancel", "tool", "tool", "tool", "tool", "note"]);
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Text", exact: true })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
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
  // Past Send, the focus wraps to the close button at the top.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
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
  expect(await events(page)).toEqual(["open", "close"]);
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
  expect(await events(page)).toEqual(["open", "close"]);
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
    w.copy = createFeedback({ trigger: "none" });
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
  await mount(page);
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
