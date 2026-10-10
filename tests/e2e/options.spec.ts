import { expect, type Page, test } from "@playwright/test";
import { defaultType, events, failable, type Mounted, mount } from "./widget";

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
  await expect(page.getByRole("button", { name: "X trigger" })).toHaveText("X triggerText");
  await page.getByRole("button", { name: "X trigger" }).click();
  const dialog = page.getByRole("dialog", { name: "X title" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("X escHint")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { live: string[] }).live))
    .toEqual(["X capturing"]);
  await expect(page.locator("visual-feedback").locator(".live")).toHaveCount(0);
  for (const name of ["X pen", "X box", "X arrow", "X undo", "X clear", "X cancel", "X send"]) {
    await expect(dialog.getByRole("button", { name })).toBeVisible();
  }
  await expect(dialog.getByLabel("X noteLabel")).toHaveAttribute(
    "placeholder",
    "X notePlaceholder",
  );
  await expect(dialog.getByLabel("X categoryLabel")).toBeVisible();
  await dialog.getByRole("button", { name: "X send" }).click();
  await expect(page.getByRole("alert")).toHaveText("X noteRequired");
  await dialog.getByLabel("X noteLabel").fill("A note");
  await dialog.getByRole("button", { name: "X send" }).click();
  await expect(page.getByRole("alert")).toHaveText("X error");
  await expect(dialog.getByRole("button", { name: "X retry" })).toBeVisible();
  await dialog.getByRole("button", { name: "X retry" }).click();
  await expect(page.getByRole("status")).toHaveText("X sent");
});

test("the trigger shows Feedback, or the translated trigger name when only that is given", async ({
  page,
}) => {
  await mount(page);
  await expect(page.getByRole("button", { name: "Send feedback", exact: true })).toHaveText(
    "Feedback",
  );
  await vf(page, "update", { strings: { trigger: "Envoyer un avis" } });
  await expect(page.getByRole("button", { name: "Envoyer un avis", exact: true })).toHaveText(
    "Envoyer un avis",
  );
  await vf(page, "update", { strings: { trigger: "Envoyer un avis", triggerText: "Avis" } });
  await expect(page.getByRole("button", { name: "Envoyer un avis", exact: true })).toHaveText(
    "Avis",
  );
  // Only the visible text given: the name is that text, so voice control finds what it shows.
  await vf(page, "update", { strings: { triggerText: "Help" } });
  await expect(page.getByRole("button", { name: "Help", exact: true })).toHaveText("Help");
  // An empty label, as an i18n lookup can return, still leaves the button its English name.
  await vf(page, "update", { strings: { triggerText: "" } });
  await expect(page.getByRole("button", { name: "Send feedback", exact: true })).toBeVisible();
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
  await expect(page.getByRole("status")).toHaveText("Thanks, it's sent.");
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
  await page.keyboard.press("Escape");
  await vf(page, "update", { shortcut: "Alt+F2" });
  await page.keyboard.press("Control+Shift+Digit1");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Alt+F2");
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("update changes the trigger, theme, css and texts at once", async ({ page }) => {
  await mount(page);
  const trigger = () => page.locator("visual-feedback").locator(".trigger");
  await vf(page, "update", { position: "top-left", strings: { trigger: "Feedback" } });
  const box = await page.getByRole("button", { name: "Feedback", exact: true }).boundingBox();
  expect([Math.round(box?.x ?? -1), Math.round(box?.y ?? -1)]).toEqual([16, 16]);

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
  await page.keyboard.press("Escape");
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
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await vf(page, "update", { shortcut: "Cmd+K" });
  expect(await taken(page, { key: "k", code: "KeyK" })).toBe(false);
  expect(await taken(page, { key: "k", code: "KeyK", metaKey: true })).toBe(false);
  await vf(page, "update", { shortcut: "Meta+K" });
  expect(await taken(page, { key: "k", code: "KeyK", metaKey: true })).toBe(true);
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
  await expect(page.getByRole("status")).toHaveText("Thanks, it's sent.");
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
  expect(Math.round((viewport?.width ?? 0) - (box?.x ?? 0) - (box?.width ?? 0))).toBe(16);
  await page.getByRole("button", { name: "Send feedback" }).click();
  await page.getByLabel("Your note").fill("A note");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Thanks, it's sent.");
  const image = await page.evaluate(async () => {
    const blob = (window as unknown as Mounted).reports.at(-1)?.image;
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
  await expect(page.getByRole("status")).toHaveText("Thanks, it's sent.");
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
