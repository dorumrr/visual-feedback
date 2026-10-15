import { expect, type Page, test } from "@playwright/test";
import { confirmed, defaultType, events, failable, type Mounted, mount } from "./widget";

const KEYS = [
  "trigger",
  "title",
  "capturing",
  "captureError",
  "sendWithout",
  "noteLabel",
  "notePlaceholder",
  "noteRequired",
  "categoryLabel",
  "pen",
  "box",
  "arrow",
  "undo",
  "clear",
  "cancel",
  "send",
  "sending",
  "sent",
  "error",
  "retry",
  "triggerText",
  "escHint",
  "text",
  "select",
  "remove",
  "minimise",
  "screenshot",
  "addScreenshot",
  "removeScreenshot",
  "draft",
  "captureView",
  "reopen",
  "discard",
  "moreSend",
  "savePdf",
] as const;
const STRINGS = Object.fromEntries(KEYS.map((key) => [key, `X ${key}`]));

const vf = (page: Page, call: string, arg?: unknown) =>
  page.evaluate(
    ([call, arg]) => {
      const widget = (window as unknown as Mounted).vf as unknown as Record<
        string,
        (value?: unknown) => unknown
      >;
      return widget[call as string]?.(arg);
    },
    [call, arg] as const,
  );

// Every text the live region shows, read from inside the shadow root as it changes.
const watchLive = (page: Page) =>
  page.evaluate(() => {
    const root = document.querySelector("visual-feedback")?.shadowRoot;
    const seen: string[] = [];
    (window as unknown as { live: string[] }).live = seen;
    if (!root) return;
    new MutationObserver(() => {
      const text = root.querySelector(".live")?.textContent;
      if (text && !seen.includes(text)) seen.push(text);
    }).observe(root, { subtree: true, childList: true, characterData: true });
  });

test.beforeEach(async ({ page }) => {
  await page.goto("/widget/capture.html");
});

test("strings replace every text the widget shows", async ({ page }) => {
  await mount(page, {
    strings: STRINGS,
    categories: [{ id: "bug", label: "Bug" }],
    // A fresh key: the fake endpoint counts its failures by key, across browsers.
    endpoint: `/api/feedback/${crypto.randomUUID()}?fail=1`,
    onSubmit: undefined,
  });
  await watchLive(page);
  await expect(
    page.getByRole("button", { name: "X trigger" }).locator('[part="trigger-text"]'),
  ).toHaveText("X triggerText");
  await page.getByRole("button", { name: "X trigger" }).click();
  const dialog = page.getByRole("dialog", { name: "X title" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("X escHint")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { live: string[] }).live))
    .toEqual(["X capturing"]);
  await expect(page.locator("visual-feedback").locator(".live")).toHaveCount(0);
  for (const name of [
    "X pen",
    "X box",
    "X arrow",
    "X text",
    "X select",
    "X remove",
    "X undo",
    "X clear",
    "X cancel",
    "X send",
    "X minimise",
    "X screenshot 1",
    "X addScreenshot",
    "X moreSend",
  ]) {
    await expect(dialog.getByRole("button", { name })).toBeVisible();
  }
  await dialog.getByRole("button", { name: "X moreSend" }).click();
  await expect(dialog.getByRole("menuitem", { name: "X savePdf" })).toBeVisible();
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "X addScreenshot" }).click();
  const bar = page.getByRole("region", { name: "X draft" });
  await expect(bar).toContainText("X draft · 1");
  await expect(bar.getByRole("button", { name: "X reopen" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "X discard" })).toBeVisible();
  await bar.getByRole("button", { name: "X captureView" }).click();
  await expect(dialog.getByRole("button", { name: "X removeScreenshot 2" })).toBeVisible();
  await expect(dialog.getByLabel("X noteLabel")).toHaveAttribute(
    "placeholder",
    "X notePlaceholder",
  );
  await expect(dialog.getByLabel("X categoryLabel")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "X send" })).toHaveAccessibleDescription(
    "X noteRequired",
  );
  await dialog.getByLabel("X noteLabel").fill("A note");
  await dialog.getByRole("button", { name: "X send" }).click();
  await expect(page.getByRole("alert")).toHaveText("X error");
  await expect(dialog.getByRole("button", { name: "X retry" })).toBeVisible();
  await dialog.getByRole("button", { name: "X retry" }).click();
  await confirmed(page, "X sent");
});

test("an empty triggerText at creation leaves the icon alone, 40 px square", async ({ page }) => {
  await mount(page, { strings: { triggerText: "" } });
  const named = page.getByRole("button", { name: "Send feedback", exact: true });
  await expect(named.locator('[part="trigger-text"]')).toBeHidden();
  const box = await named.boundingBox();
  expect([box?.width, box?.height]).toEqual([40, 40]);
});

test("the trigger is an icon alone, and shows text only when triggerText is given", async ({
  page,
}) => {
  await mount(page);
  const shown = (name: string) =>
    page.getByRole("button", { name, exact: true }).locator('[part="trigger-text"]');
  await expect(shown("Send feedback")).toHaveText("");
  await vf(page, "update", { strings: { trigger: "Envoyer un avis" } });
  await expect(shown("Envoyer un avis")).toHaveText("");
  await vf(page, "update", { strings: { trigger: "Envoyer un avis", triggerText: "Avis" } });
  await expect(shown("Envoyer un avis")).toHaveText("Avis");
  // Only the visible text given: the name is that text, so voice control finds what it shows.
  await vf(page, "update", { strings: { triggerText: "Help" } });
  await expect(shown("Help")).toHaveText("Help");
  // An empty label, as an i18n lookup can return, still leaves the button its English name.
  await vf(page, "update", { strings: { triggerText: "" } });
  const named = page.getByRole("button", { name: "Send feedback", exact: true });
  await expect(shown("Send feedback")).toHaveText("");
  // Without text it is square again.
  const box = await named.boundingBox();
  expect(Math.round(box?.width ?? 0)).toBe(Math.round(box?.height ?? -1));
});

test("strings show while sending, and a partial set keeps English for the rest", async ({
  page,
}) => {
  await page.evaluate(() => {
    const w = window as unknown as Mounted;
    w.hold = new Promise((resolve) => {
      w.release = resolve;
    });
  });
  await mount(page, { strings: { sending: "X sending", send: "Go" } });
  await page.getByRole("button", { name: "Send feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await dialog.getByLabel("Your note").fill("A note");
  await dialog.getByRole("button", { name: "Go" }).click();
  await expect(dialog.getByRole("button", { name: "X sending" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  await page.evaluate(() => (window as unknown as Mounted).release?.());
  await confirmed(page);
});

test("strings name the capture error and its buttons", async ({ page }) => {
  await failable(page);
  await mount(page, { strings: STRINGS });
  await page.getByRole("button", { name: "X trigger" }).click();
  await expect(page.getByRole("alert")).toHaveText("X captureError");
  for (const name of ["X retry", "X sendWithout", "X cancel"]) {
    await expect(page.getByRole("button", { name })).toBeVisible();
  }
});

test("the shortcut opens the widget only with its exact modifiers, once", async ({ page }) => {
  await mount(page, { shortcut: "Alt+Shift+F" });
  // The listener answers at once: a matched key has its default prevented, any other does not.
  const handled = await page.evaluate(() =>
    [
      {},
      { shiftKey: true },
      { altKey: true },
      { ctrlKey: true, altKey: true, shiftKey: true },
      { altKey: true, shiftKey: true },
    ].map((mods) => {
      const event = new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        cancelable: true,
        ...mods,
      });
      dispatchEvent(event);
      return event.defaultPrevented;
    }),
  );
  expect(handled).toEqual([false, false, false, false, true]);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Alt+Shift+KeyF");
  expect(await events(page)).toEqual(["open"]);
});

test("a shortcut on a digit or a named key also opens it", async ({ page }) => {
  await mount(page, { shortcut: "Control+Shift+1" });
  await page.keyboard.press("Control+Shift+Digit1");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await vf(page, "update", { shortcut: "Alt+F2" });
  await page.keyboard.press("Control+Shift+Digit1");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Alt+F2");
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("by default the trigger is a tab in the corner, square on both edges, with no border", async ({
  page,
}) => {
  await mount(page);
  // By class: a label given alone renames it.
  const trigger = page.locator("visual-feedback").locator(".trigger");
  const { width = 0, height = 0 } = page.viewportSize() ?? {};
  const edges = async () => {
    const box = await trigger.boundingBox();
    if (!box) throw new Error("no trigger");
    const [left, top] = [box.x, box.y].map(Math.round);
    const right = Math.round(width - box.x - box.width);
    const bottom = Math.round(height - box.y - box.height);
    return { size: [box.width, box.height], left, top, right, bottom };
  };
  /** Each side's border width, and each corner's radius as "0px" or "rounded". */
  const shape = () =>
    trigger.evaluate((element) => {
      const style = getComputedStyle(element);
      const sides = ["top", "right", "bottom", "left"].map((side) =>
        style.getPropertyValue(`border-${side}-width`),
      );
      const corners = ["top-left", "top-right", "bottom-right", "bottom-left"].map((corner) =>
        style.getPropertyValue(`border-${corner}-radius`) === "0px" ? "0px" : "rounded",
      );
      return { sides, corners };
    });
  expect(await edges()).toMatchObject({ size: [40, 40], right: 0, bottom: 0 });
  expect(await shape()).toEqual({
    sides: ["0px", "0px", "0px", "0px"],
    corners: ["rounded", "0px", "0px", "0px"],
  });
  // A label makes it wider, still in the corner.
  await vf(page, "update", { strings: { triggerText: "Feedback" } });
  const wide = await edges();
  expect(wide.size[0]).toBeGreaterThan(40);
  expect(wide).toMatchObject({ right: 0, bottom: 0 });
  expect((await shape()).sides).toEqual(["0px", "0px", "0px", "0px"]);
  await vf(page, "update", { strings: undefined });
  for (const [position, corners] of [
    ["top-left", ["0px", "0px", "rounded", "0px"]],
    ["top-right", ["0px", "0px", "0px", "rounded"]],
    ["bottom-left", ["0px", "rounded", "0px", "0px"]],
  ] as const) {
    await vf(page, "update", { position });
    const [y, x] = position.split("-") as ["top" | "bottom", "left" | "right"];
    expect(await edges(), position).toMatchObject({ [x]: 0, [y]: 0 });
    expect((await shape()).corners, position).toEqual(corners);
  }
  await vf(page, "update", { position: "top-left" });
  // The round button stays one option away, in its corner.
  await vf(page, "update", { trigger: "button" });
  expect(await edges()).toMatchObject({ size: [40, 40], left: 16, top: 16 });
  await expect(trigger).toHaveCSS("border-left-width", "0px");
  await expect(trigger).toHaveCSS("border-top-left-radius", "999px");
});

test("the trigger's tooltip shows at once on hover or keyboard focus, and points at it", async ({
  page,
}) => {
  await mount(page);
  const trigger = page.getByRole("button", { name: "Send feedback" });
  const tip = page.locator("visual-feedback").locator(".tip");
  await expect(tip).toHaveText("Send feedback");
  await expect(tip).toHaveAttribute("part", "trigger-tooltip");
  // The trigger's own colours at rest: readable on any theme.
  const [text, surface] = await trigger.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.backgroundColor, style.color];
  });
  await expect(tip).toHaveCSS("background-color", text);
  await expect(tip).toHaveCSS("color", surface);
  // No title too: the browser's own tooltip would show late, over this one.
  expect(await trigger.getAttribute("title")).toBeNull();
  await expect(tip).toHaveCSS("opacity", "0");
  await expect(tip).toHaveCSS("transition-delay", /^0s(, 0s)*$/);
  // One transition, on the tooltip itself: the fade in and the fade out take the same time.
  const fade = await tip.evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(fade).toMatch(/^0\.15s(, 0\.15s)*$/);
  await expect(tip).toBeHidden();
  await trigger.hover();
  await expect(tip).toHaveCSS("opacity", "1");
  await expect(tip).toBeVisible();
  expect(await tip.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe(fade);
  // Left of the tab, centred on it, with a click passing through to the page.
  const [t, b] = [await tip.boundingBox(), await trigger.boundingBox()];
  if (!t || !b) throw new Error("no box");
  expect(Math.round(b.x - (t.x + t.width))).toBe(10);
  expect(Math.abs(t.y + t.height / 2 - (b.y + b.height / 2))).toBeLessThan(1);
  await expect(tip).toHaveCSS("pointer-events", "none");
  await page.mouse.move(0, 0);
  await expect(tip).toHaveCSS("opacity", "0");
  // After a key press, so the focus counts as the keyboard's and matches :focus-visible.
  await page.keyboard.press("Shift");
  await trigger.focus();
  expect(await trigger.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
  await expect(tip).toHaveCSS("opacity", "1");
  // On the left edge it sits right of the trigger.
  await vf(page, "update", { position: "bottom-left" });
  const [left, button] = [await tip.boundingBox(), await trigger.boundingBox()];
  if (!left || !button) throw new Error("no box");
  expect(Math.round(left.x - (button.x + button.width))).toBe(10);
});

test("on a touch screen, which cannot hover, the trigger keeps its colours and shows no tooltip", async ({
  browser,
  browserName,
}) => {
  test.skip(browserName === "firefox", "Playwright has no mobile emulation in Firefox");
  const context = await browser.newContext({
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("/widget/");
  expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);
  await mount(page);
  const trigger = page.locator("visual-feedback").locator(".trigger");
  const tip = trigger.locator(".tip");
  const before = await trigger.evaluate((element) => getComputedStyle(element).backgroundColor);
  // A tap leaves :hover behind on a touch screen, until the next tap elsewhere.
  await trigger.hover();
  // Read once the 0.15s fade would be over: a poll could pass on its first frame.
  await page.waitForTimeout(300);
  expect(await trigger.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    before,
  );
  await expect(tip).toBeHidden();
  await context.close();
});

test("on a right-to-left page the tooltip's arrow still points at the trigger, and a long name wraps on screen", async ({
  page,
}) => {
  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
  });
  await mount(page, { strings: { trigger: "إرسال ملاحظات" } });
  const trigger = page.getByRole("button", { name: "إرسال ملاحظات" });
  const tip = page.locator("visual-feedback").locator(".tip");
  await trigger.hover();
  await expect(tip).toHaveCSS("opacity", "1");
  const [arrow, name] = [
    await tip.locator("svg").boundingBox(),
    await tip.locator("span").boundingBox(),
  ];
  if (!arrow || !name) throw new Error("no box");
  // The tab is on the right edge, so the arrow is the tooltip's right end.
  expect(arrow.x).toBeGreaterThanOrEqual(name.x + name.width);
  await expect(tip.locator("span")).toHaveAttribute("dir", "auto");

  await page.setViewportSize({ width: 320, height: 640 });
  const long = "A long name a site might give its feedback button, longer than the screen";
  await vf(page, "update", { strings: { trigger: long } });
  await page.getByRole("button", { name: long }).hover();
  await expect(tip).toHaveCSS("opacity", "1");
  const box = await tip.boundingBox();
  if (!box) throw new Error("no tooltip");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.height).toBeGreaterThan(40);
  // A label widens the trigger, and the tooltip's room shrinks with it.
  await vf(page, "update", { strings: { trigger: long, triggerText: "Feedback" } });
  await page.getByRole("button", { name: long }).hover();
  await expect(tip).toHaveCSS("opacity", "1");
  expect((await tip.boundingBox())?.x).toBeGreaterThanOrEqual(0);
  // The round button keeps 16 px from the edge, and the tooltip's padding stays inside its room.
  await vf(page, "update", { trigger: "button", strings: { trigger: long } });
  await page.mouse.move(0, 0);
  await page.getByRole("button", { name: long }).hover();
  await expect(tip).toHaveCSS("opacity", "1");
  expect((await tip.boundingBox())?.x).toBeGreaterThanOrEqual(0);
});

test("the trigger's tooltip names a working shortcut as the platform's keyboards do", async ({
  page,
}) => {
  const title = () =>
    page.locator("visual-feedback").locator(".tip").textContent({ timeout: 1000 });
  const platform = (name: string) =>
    page.evaluate((name) => {
      Object.defineProperty(Navigator.prototype, "platform", {
        get: () => name,
        configurable: true,
      });
    }, name);
  await platform("Linux x86_64");
  await mount(page);
  // Without a shortcut it names the icon, as the widget's other icon buttons do.
  expect(await title()).toBe("Send feedback");
  await vf(page, "update", { shortcut: "alt+shift+f" });
  expect(await title()).toBe("Send feedback (Alt + Shift + F)");
  // The listener takes it in any case, so the keys the tooltip names open the widget.
  await page.keyboard.press("Alt+Shift+KeyF");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await vf(page, "update", { shortcut: "Control+Meta+F2", strings: { trigger: "Report" } });
  expect(await title()).toBe("Report (Ctrl + Super + F2)");
  // A new name alone, here a visible text that is the name too, changes the tooltip.
  await vf(page, "update", { strings: { triggerText: "Feedback" } });
  expect(await title()).toBe("Feedback (Ctrl + Super + F2)");
  await platform("Win32");
  await vf(page, "update", { shortcut: "Control+Alt+Meta+Shift+K", strings: undefined });
  expect(await title()).toBe("Send feedback (Ctrl + Alt + Win + Shift + K)");
  for (const name of ["iPhone", "iPad"]) {
    await platform(name);
    await vf(page, "update", { shortcut: "Control+Alt+Meta+Shift+K" });
    expect(await title(), name).toBe("Send feedback (Control + Option + Command + Shift + K)");
  }
  await platform("MacIntel");
  await vf(page, "update", { shortcut: "Alt+Shift+F" });
  expect(await title()).toBe("Send feedback (Option + Shift + F)");
  // A screen reader gets the shortcut too, and the name stays as it was.
  await expect(
    page.getByRole("button", { name: "Send feedback", exact: true }),
  ).toHaveAccessibleDescription("Send feedback (Option + Shift + F)");
  await vf(page, "update", { shortcut: "Control+Meta+K" });
  expect(await title()).toBe("Send feedback (Control + Command + K)");
  // The listener takes a repeated modifier as one key press.
  await vf(page, "update", { shortcut: "Shift+shift+F" });
  expect(await title()).toBe("Send feedback (Shift + F)");
  // A shortcut the listener can never match is not shown.
  for (const shortcut of ["Cmd+K", "Alt+", false]) {
    await vf(page, "update", { shortcut: "Alt+Shift+F" });
    expect(await title()).toBe("Send feedback (Option + Shift + F)");
    await vf(page, "update", { shortcut });
    expect(await title(), String(shortcut)).toBe("Send feedback");
  }
  await vf(page, "update", { shortcut: "Shift+Cmd+K" });
  expect(await title()).toBe("Send feedback");
  // Given at creation, in the host's order, and kept when the trigger is drawn again.
  await vf(page, "destroy");
  await mount(page, { shortcut: "Shift+Alt+K" });
  expect(await title()).toBe("Send feedback (Shift + Option + K)");
  await vf(page, "update", { trigger: "none" });
  await vf(page, "update", { trigger: "button" });
  expect(await title()).toBe("Send feedback (Shift + Option + K)");
});

test("update changes the trigger, theme, css and texts at once", async ({ page }) => {
  await mount(page);
  const trigger = () => page.locator("visual-feedback").locator(".trigger");
  await vf(page, "update", { position: "top-left", strings: { trigger: "Feedback" } });
  const box = await page.getByRole("button", { name: "Feedback", exact: true }).boundingBox();
  expect([Math.round(box?.x ?? -1), Math.round(box?.y ?? -1)]).toEqual([0, 0]);

  await page.emulateMedia({ colorScheme: "light" });
  await vf(page, "update", { theme: "dark" });
  const scheme = () =>
    page.evaluate(() => {
      const wrapper = document.querySelector("visual-feedback")?.shadowRoot?.querySelector(".vf");
      return wrapper ? getComputedStyle(wrapper).colorScheme : "";
    });
  expect(await scheme()).toBe("dark");
  await vf(page, "update", { theme: "auto" });
  expect(await scheme()).toBe("light dark");

  await vf(page, "update", { css: ".trigger{border-radius:5px}" });
  await expect(trigger()).toHaveCSS("border-top-left-radius", "5px");
  await vf(page, "update", { css: ".trigger{border-radius:3px}" });
  await expect(trigger()).toHaveCSS("border-top-left-radius", "3px");
  await vf(page, "update", { unstyled: true });
  await expect(trigger()).toHaveCSS("border-top-left-radius", "3px");
  await expect(trigger()).toHaveCSS("cursor", "default");

  await vf(page, "update", { trigger: "none" });
  await expect(trigger()).toHaveCount(0);
  await vf(page, "update", { trigger: "button" });
  await expect(trigger()).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Feedback", exact: true })).toBeVisible();
});

test("update leaves an open dialog as it is, and its dialog options apply at the next open", async ({
  page,
}) => {
  await mount(page);
  await page.getByRole("button", { name: "Send feedback" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Draw" })).toBeVisible();
  await vf(page, "update", { tools: ["box"], strings: { title: "Later" } });
  await expect(dialog.getByRole("button", { name: "Draw" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Send feedback" })).toBeVisible();
  // A kept draft opens again as it was.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Send feedback" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByRole("dialog", { name: "Later" })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Draw" })).toHaveCount(0);
  await expect(page.getByRole("dialog").getByRole("button", { name: "Box" })).toBeVisible();
});

test("update ignores tagName and container", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const box = document.createElement("section");
    box.id = "other";
    document.body.append(box);
    (window as unknown as Mounted).vf.update({ tagName: "x-other", container: box });
  });
  await expect(page.locator("body > visual-feedback")).toHaveCount(1);
  await expect(page.locator("x-other")).toHaveCount(0);
  await expect(page.locator("#other > *")).toHaveCount(0);
});

// Dispatches one keydown on `target` and reports whether the widget took it.
const taken = (page: Page, init: Record<string, string | boolean>) =>
  page.evaluate((init) => {
    const { target, ...rest } = init;
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      composed: true,
      cancelable: true,
      ...rest,
    });
    (typeof target === "string" ? document.querySelector(target) : window)?.dispatchEvent(event);
    return event.defaultPrevented;
  }, init);

test("the shortcut leaves fields, IME input, AltGr, held keys and unknown names alone", async ({
  page,
}) => {
  await page.evaluate(() => {
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    editable.id = "editable";
    const host = document.createElement("div");
    host.id = "host";
    host.attachShadow({ mode: "open" }).append(document.createElement("input"));
    document.body.append(
      document.createElement("input"),
      document.createElement("textarea"),
      editable,
      host,
    );
  });
  await mount(page, { shortcut: "Alt+Shift+F" });
  const altShiftF = { key: "f", code: "KeyF", altKey: true, shiftKey: true };
  for (const target of ["input", "textarea", "#editable"]) {
    expect(await taken(page, { ...altShiftF, target }), target).toBe(false);
  }
  // An input inside another component's shadow root: the window sees the host as target.
  const inShadow = await page.evaluate((init) => {
    const input = document.querySelector("#host")?.shadowRoot?.querySelector("input");
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      composed: true,
      cancelable: true,
      ...init,
    });
    input?.dispatchEvent(event);
    return event.defaultPrevented;
  }, altShiftF);
  expect(inShadow).toBe(false);
  expect(await taken(page, { ...altShiftF, isComposing: true })).toBe(false);
  expect(await taken(page, { ...altShiftF, repeat: true })).toBe(false);

  await vf(page, "update", { shortcut: "Control+Alt+L" });
  const controlAltL = { key: "l", code: "KeyL", ctrlKey: true, altKey: true };
  expect(await taken(page, { ...controlAltL, modifierAltGraph: true })).toBe(false);
  // With Control, the shortcut also works from a field.
  expect(await taken(page, { ...controlAltL, target: "input" })).toBe(true);
  await expect(page.getByRole("dialog")).toBeVisible();
  // Open already: the key goes on to the page.
  expect(await taken(page, controlAltL)).toBe(false);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await vf(page, "update", { shortcut: "Cmd+K" });
  expect(await taken(page, { key: "k", code: "KeyK" })).toBe(false);
  expect(await taken(page, { key: "k", code: "KeyK", metaKey: true })).toBe(false);
  await vf(page, "update", { shortcut: "Meta+K" });
  expect(await taken(page, { key: "k", code: "KeyK", metaKey: true })).toBe(true);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // With no key it matches nothing, not even a key press whose code is empty.
  await vf(page, "update", { shortcut: "Alt+" });
  expect(await taken(page, { key: "", code: "", altKey: true })).toBe(false);
});

test("a string given as undefined keeps English, and update replaces strings whole", async ({
  page,
}) => {
  await mount(page, { strings: { title: "A", send: "B" } });
  await page.evaluate(() =>
    (window as unknown as Mounted).vf.update({ strings: { title: undefined, cancel: "C" } }),
  );
  await page.getByRole("button", { name: "Send feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "C", exact: true })).toBeVisible();
});

test("update's endpoint is used at the next send, and unstyled can be turned off again", async ({
  page,
}) => {
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  await mount(page, { endpoint: `/api/feedback/${first}`, onSubmit: undefined });
  await vf(page, "update", { endpoint: `/api/feedback/${second}`, unstyled: true });
  await vf(page, "update", { unstyled: false });
  await expect(page.locator("visual-feedback").locator(".trigger")).toHaveCSS("cursor", "pointer");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await page.getByLabel("Your note").fill("A note");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await confirmed(page);
  const received = async (key: string) =>
    ((await (await page.request.get(`/api/feedback/${key}`)).json()) as unknown[]).length;
  expect([await received(first), await received(second)]).toEqual([0, 1]);
});

test("update: undefined puts a key back to its default, and capture is replaced whole", async ({
  page,
}) => {
  await mount(page, { position: "top-left", capture: { type: "image/png", maxWidth: 400 } });
  await page.evaluate(() =>
    (window as unknown as Mounted).vf.update({
      position: undefined,
      capture: { maxWidth: 300 },
    }),
  );
  const box = await page.getByRole("button", { name: "Send feedback" }).boundingBox();
  const viewport = page.viewportSize();
  expect(Math.round((viewport?.width ?? 0) - (box?.x ?? 0) - (box?.width ?? 0))).toBe(0);
  await page.getByRole("button", { name: "Send feedback" }).click();
  await page.getByLabel("Your note").fill("A note");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await confirmed(page);
  const image = await page.evaluate(async () => {
    const blob = (window as unknown as Mounted).reports.at(-1)?.screenshots[0]?.image;
    return blob ? { type: blob.type, width: (await createImageBitmap(blob)).width } : null;
  });
  expect(image).toEqual({
    type: await defaultType(page),
    width: 300,
  });
});

test("update: headers and redactUrl at the next send, requireNote and categories at the next open", async ({
  page,
}) => {
  const key = crypto.randomUUID();
  await page.goto("/widget/capture.html?secret=1#part");
  await mount(page, { endpoint: `/api/feedback/${key}`, onSubmit: undefined });
  await vf(page, "update", {
    headers: { "x-test": "yes" },
    redactUrl: true,
    requireNote: false,
    categories: [{ id: "bug", label: "Bug" }],
  });
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByLabel("Type")).toBeVisible();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await confirmed(page);
  const [received] = (await (await page.request.get(`/api/feedback/${key}`)).json()) as {
    headers: Record<string, string>;
    body: string;
  }[];
  expect(received?.headers["x-test"]).toBe("yes");
  const body = Buffer.from(received?.body ?? "", "base64").toString("latin1");
  expect(body).toContain('"url":"http://127.0.0.1');
  expect(body).not.toContain("secret=1");
});

test("a keydown that is not a keyboard event, as autofill sends, is ignored without an error", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(page, { shortcut: "F" });
  await page.evaluate(() => {
    dispatchEvent(new Event("keydown"));
    document.body.dispatchEvent(new Event("keydown", { bubbles: true }));
  });
  await page.keyboard.press("F");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(errors).toEqual([]);
});

test("when the dialog cannot be shown, error fires, the trigger works again and gets the focus", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(page);
  await page.evaluate(() => {
    const w = window as unknown as Mounted;
    w.vf.on("error", () => w.events.push("error"));
    const real = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = () => {
      HTMLDialogElement.prototype.showModal = real;
      throw new DOMException("refused", "InvalidStateError");
    };
  });
  const trigger = page.getByRole("button", { name: "Send feedback" });
  await trigger.click();
  await expect.poll(() => events(page)).toEqual(["error"]);
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
  // A host's own open() rejects when the dialog cannot be shown.
  const opened = await page.evaluate(() => {
    const real = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = () => {
      HTMLDialogElement.prototype.showModal = real;
      throw new DOMException("refused", "InvalidStateError");
    };
    return (window as unknown as Mounted).vf.open().then(
      () => "resolved",
      () => "rejected",
    );
  });
  expect(opened).toBe("rejected");
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await events(page)).toEqual(["error", "error", "open"]);
});

test("any failure while opening, as in building the dialog's styles, leaves a trigger that works", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(page);
  await page.evaluate(() => {
    const w = window as unknown as Mounted;
    w.vf.on("error", () => w.events.push("error"));
    const real = CSSStyleSheet.prototype.replaceSync;
    CSSStyleSheet.prototype.replaceSync = () => {
      CSSStyleSheet.prototype.replaceSync = real;
      throw new DOMException("refused", "NotAllowedError");
    };
  });
  const trigger = page.getByRole("button", { name: "Send feedback" });
  await trigger.click();
  await expect.poll(() => events(page)).toEqual(["error"]);
  await expect(trigger).toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await events(page)).toEqual(["error", "open"]);
  expect(errors).toEqual([]);
});

test("a failure while Try again shows the new screenshot fires error and leaves a trigger that works", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await failable(page);
  await mount(page);
  await page.evaluate(() => {
    const w = window as unknown as Mounted;
    w.vf.on("error", () => w.events.push("error"));
  });
  const trigger = page.getByRole("button", { name: "Send feedback" });
  await trigger.click();
  await expect(page.getByRole("alert")).toHaveText("Couldn't take a screenshot.");
  await page.evaluate(() => {
    (window as unknown as { failCapture: boolean }).failCapture = false;
    const real = Element.prototype.replaceChildren;
    Element.prototype.replaceChildren = () => {
      Element.prototype.replaceChildren = real;
      throw new DOMException("refused", "InvalidStateError");
    };
  });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => events(page)).toEqual(["open", "close", "error"]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeVisible();
  expect(errors).toEqual([]);
  await trigger.click();
  await expect(page.getByRole("textbox", { name: "Your note" })).toBeVisible();
});
