import { expect, type Page, test } from "@playwright/test";
import { markdown } from "../recipes/doc";
import { failable, type Mounted, mount, withoutSupport } from "./widget";

const VARIABLES = [
  "--vf-radius",
  "--vf-surface",
  "--vf-text",
  "--vf-muted",
  "--vf-border",
  "--vf-accent",
  "--vf-accent-text",
  "--vf-focus",
  "--vf-mark",
  "--vf-backdrop",
  "--vf-shadow",
  "--vf-trigger-size",
  "--vf-offset",
  "--vf-z",
];

// One list of part names: the one THEMING.md gives.
const { doc: theming } = markdown("docs/THEMING.md");
const PARTS = [
  ...(/Every visible element has a part name: ([^.]*)\./.exec(theming)?.[1] ?? "").matchAll(
    /`([\w-]+)`/g,
  ),
].map((match) => match[1] ?? "");

/** Each variable's resolved value inside the shadow root, from the private name it feeds. */
function resolved(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const wrapper = document.querySelector("visual-feedback")?.shadowRoot?.querySelector(".vf");
    if (!wrapper) return {};
    const style = getComputedStyle(wrapper);
    const sheetText = [...(wrapper.getRootNode() as ShadowRoot).adoptedStyleSheets]
      .flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText))
      .join("\n");
    const result: Record<string, string> = {};
    for (const [, name, variable] of sheetText.matchAll(/(--_[\w-]+):\s*var\((--vf-[\w-]+)/g)) {
      if (name && variable) result[variable] = style.getPropertyValue(name).trim();
    }
    return result;
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/widget/");
});

test("every --vf-* variable has a default, and the host beats an ancestor", async ({ page }) => {
  await mount(page);
  const defaults = await resolved(page);
  expect(Object.keys(defaults).sort()).toEqual([...VARIABLES].sort());
  for (const variable of VARIABLES) expect(defaults[variable], variable).not.toBe("");

  await page.addStyleTag({
    content: `body { ${VARIABLES.map((v) => `${v}: 1px`).join(";")} }`,
  });
  const fromAncestor = await resolved(page);
  for (const variable of VARIABLES) expect(fromAncestor[variable], variable).toBe("1px");

  await page.addStyleTag({
    content: `visual-feedback { ${VARIABLES.map((v) => `${v}: 2px`).join(";")} }`,
  });
  const fromHost = await resolved(page);
  for (const variable of VARIABLES) expect(fromHost[variable], variable).toBe("2px");
});

test("each variable reaches the element that uses it, and its default matches THEMING.md", async ({
  page,
}) => {
  const probe = (color: string) =>
    page.evaluate((color) => {
      const element = document.createElement("div");
      element.style.color = color;
      document.body.append(element);
      const value = getComputedStyle(element).color;
      element.remove();
      return value;
    }, color);
  await page.emulateMedia({ colorScheme: "light" });
  await mount(page);
  // By class, not role: a draft hides the trigger, and its colours still resolve while hidden.
  const trigger = page.locator("visual-feedback").locator(".trigger");
  await expect(trigger).toHaveCSS("background-color", await probe("Canvas"));
  await expect(trigger).toHaveCSS("color", await probe("CanvasText"));
  await expect(trigger).toHaveCSS("box-shadow", "rgba(0, 0, 0, 0.35) 0px 12px 32px -12px");
  await expect(trigger).toHaveCSS("z-index", "2147483000");
  await trigger.click();
  const panel = page.locator("visual-feedback .dialog");
  const backdrop = page.getByRole("dialog");
  const note = page.getByRole("textbox", { name: "Your note" });
  const muted = () => note.evaluate((element) => getComputedStyle(element, "::placeholder").color);
  const composer = page.locator("visual-feedback .composer");

  await expect(panel).toHaveCSS("border-top-left-radius", "16px");
  await expect(backdrop).toHaveCSS("background-color", "rgba(0, 0, 0, 0.45)");
  await expect(trigger).toHaveCSS(
    "border-top-color",
    await probe("color-mix(in srgb, CanvasText 15%, transparent)"),
  );
  expect(await muted()).toBe(await probe("color-mix(in srgb, CanvasText 60%, transparent)"));

  await page.addStyleTag({
    content: `visual-feedback {
      --vf-surface: rgb(1, 2, 3); --vf-text: rgb(4, 5, 6); --vf-border: rgb(7, 8, 9);
      --vf-shadow: rgb(10, 11, 12) 1px 2px 3px 0px; --vf-radius: 5px;
      --vf-backdrop: rgb(13, 14, 15); --vf-muted: rgb(16, 17, 18); --vf-accent: rgb(19, 20, 21);
    }`,
  });
  await expect(panel).toHaveCSS("background-color", "rgb(1, 2, 3)");
  await expect(trigger).toHaveCSS("background-color", "rgb(1, 2, 3)");
  await expect(trigger).toHaveCSS("color", "rgb(4, 5, 6)");
  await expect(trigger).toHaveCSS("border-top-color", "rgb(7, 8, 9)");
  await expect(trigger).toHaveCSS("box-shadow", "rgb(10, 11, 12) 1px 2px 3px 0px");
  await expect(panel).toHaveCSS("color", "rgb(4, 5, 6)");
  // The composer shows the focus colour while the note has focus, so the rail shows the border.
  await expect(page.locator("visual-feedback .toolbar")).toHaveCSS(
    "border-top-color",
    "rgb(7, 8, 9)",
  );
  await expect(panel).toHaveCSS("box-shadow", "rgb(10, 11, 12) 1px 2px 3px 0px");
  await expect(panel).toHaveCSS("border-top-left-radius", "5px");
  await expect(composer).toHaveCSS("border-top-left-radius", "5px");
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCSS(
    "border-top-left-radius",
    "2.5px",
  );
  await expect(backdrop).toHaveCSS("background-color", "rgb(13, 14, 15)");
  expect(await muted()).toBe("rgb(16, 17, 18)");
  await expect(note).toBeFocused();
  await page.keyboard.press("Tab");
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).toBeFocused();
  await expect(send).toHaveCSS("outline-color", "rgb(19, 20, 21)");
  await page.addStyleTag({ content: "visual-feedback { --vf-focus: rgb(22, 23, 24) }" });
  await expect(send).toHaveCSS("outline-color", "rgb(22, 23, 24)");
});

test("text, icons and buttons follow the site's font size", async ({ page }) => {
  const measure = async () => {
    await page.getByRole("button", { name: "Send feedback" }).click();
    const sizes = [
      await page.getByRole("button", { name: "Draw" }).boundingBox(),
      await page.locator("visual-feedback .tool svg").first().boundingBox(),
      await page.getByRole("button", { name: "Send", exact: true }).boundingBox(),
      await page
        .getByText("Esc keeps it as a draft")
        .evaluate((hint) => getComputedStyle(hint).fontSize),
    ];
    await page.getByRole("button", { name: "Cancel" }).click();
    return sizes as [{ height: number }, { height: number }, { height: number }, string];
  };
  await mount(page);
  const [tool, icon, send, hint] = await measure();
  // On the page, not the element: the widget must inherit the site's size.
  await page.addStyleTag({ content: "body { font-size: 32px }" });
  const [bigTool, bigIcon, bigSend, bigHint] = await measure();
  // Twice the font size: every one of them about twice as big.
  for (const [small, big] of [
    [tool.height, bigTool.height],
    [icon.height, bigIcon.height],
    [send.height, bigSend.height],
    [Number.parseFloat(hint), Number.parseFloat(bigHint)],
  ]) {
    expect((big ?? 0) / (small ?? 1)).toBeGreaterThan(1.8);
  }
});

test("--vf-font sets the font, and the site's font is inherited without it", async ({ page }) => {
  await page.addStyleTag({ content: "body { font-family: Georgia, serif }" });
  await mount(page);
  await page.getByRole("button", { name: "Send feedback" }).click();
  const note = page.getByRole("textbox", { name: "Your note" });
  await expect(note).toHaveCSS("font-family", "Georgia, serif");
  // A bare family is invalid in the font shorthand, so this fails if --vf-font feeds font.
  await page.addStyleTag({ content: "visual-feedback { --vf-font: monospace }" });
  await expect(note).toHaveCSS("font-family", "monospace");
});

test("size, offset and stacking variables move the trigger", async ({ page }) => {
  await page.addStyleTag({
    content: "visual-feedback { --vf-trigger-size: 50px; --vf-offset: 40px; --vf-z: 7 }",
  });
  await mount(page);
  const trigger = page.getByRole("button", { name: "Send feedback" });
  const box = await trigger.boundingBox();
  const { width = 0, height = 0 } = page.viewportSize() ?? {};
  expect(box?.height).toBe(50);
  expect(Math.round(width - (box?.x ?? 0) - (box?.width ?? 0))).toBe(40);
  expect(Math.round(height - (box?.y ?? 0) - (box?.height ?? 0))).toBe(40);
  await expect(trigger).toHaveCSS("z-index", "7");
});

/** Each part name in the shadow root with the margin the page's ::part() rules set, and what has none. */
function parts(page: Page): Promise<string[][]> {
  return page.evaluate(() => {
    const root = document.querySelector("visual-feedback")?.shadowRoot;
    // The display: contents wrapper, the icon's path and a select's options have no box to style.
    const unparted = [...(root?.querySelectorAll(":not([part])") ?? [])].filter(
      (element) => !element.matches(".vf, svg path, option"),
    );
    return [
      ...unparted.map((element) => [`unparted ${element.tagName}`, ""]),
      ...[...(root?.querySelectorAll("[part]") ?? [])].map((element) => [
        element.getAttribute("part") ?? "",
        getComputedStyle(element).scrollMarginTop,
      ]),
    ];
  });
}

test("every element of every view has its ::part() name, and the page can style each", async ({
  page,
}) => {
  expect(PARTS.length).toBeGreaterThan(15);
  await page.addStyleTag({
    content: PARTS.map((part) => `visual-feedback::part(${part}) { scroll-margin-top: 7px }`).join(
      "\n",
    ),
  });
  await failable(page);
  await mount(page, { categories: [{ id: "bug", label: "Bug" }] });
  const dialog = page.getByRole("dialog");
  const found: string[][] = [];
  const scan = async (view: string) => {
    const seen = await parts(page);
    for (const [part, margin] of seen) expect(margin, `${view}: ${part}`).toBe("7px");
    found.push(...seen);
  };
  const open = async () => {
    await page.getByRole("button", { name: "Send feedback" }).click();
    await expect(dialog).toBeVisible();
  };

  await open();
  await expect(page.getByRole("alert")).toHaveText("Couldn't take a screenshot.");
  await scan("capture error");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.evaluate(() => {
    const w = window as unknown as Mounted & { failCapture: boolean };
    w.failCapture = false;
    w.hold = new Promise((done) => (w.release = done));
  });

  await open();
  await scan("annotating, with categories");
  // A label being typed: its input is a part too.
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const box = await page.locator("visual-feedback").locator("canvas.image").boundingBox();
  await page.mouse.click((box?.x ?? 0) + 40, (box?.y ?? 0) + 40);
  await expect(page.getByRole("textbox", { name: "Text", exact: true })).toBeFocused();
  await scan("typing a label");
  await page.keyboard.press("Escape");
  // A selected mark: its outline is a part too.
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await page.mouse.move((box?.x ?? 0) + 60, (box?.y ?? 0) + 60);
  await page.mouse.down();
  await page.mouse.move((box?.x ?? 0) + 160, (box?.y ?? 0) + 60, { steps: 4 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.mouse.click((box?.x ?? 0) + 110, (box?.y ?? 0) + 60);
  await expect(page.locator("visual-feedback .selection")).toBeVisible();
  await scan("a selected mark");
  await page.getByRole("button", { name: "Add screenshot" }).click();
  await expect(page.getByRole("region", { name: "Feedback draft" })).toBeVisible();
  await scan("draft bar");
  await page.getByRole("button", { name: "Capture this view" }).click();
  await expect(page.getByRole("button", { name: "Screenshot 2", exact: true })).toBeVisible();
  await scan("two screenshots");
  await page.getByRole("button", { name: "More send options" }).click();
  await expect(page.getByRole("menuitem", { name: "Save as PDF" })).toBeVisible();
  await scan("send menu");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Screenshot 1", exact: true }).click();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await scan("note required");
  await page.getByRole("textbox", { name: "Your note" }).fill("A note");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("button", { name: "Keep as draft", exact: true }).last(),
  ).toBeVisible();
  await scan("Cancel's question");
  await page.getByRole("button", { name: "Keep editing" }).click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Your note" })).toBeDisabled();
  await scan("sending");
  await page.evaluate(() => (window as unknown as Mounted).release?.());
  await expect(page.getByRole("status")).toHaveText("Thanks, it's sent.");
  await scan("sent");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.evaluate(() =>
    (window as unknown as Mounted).vf.update({
      onSubmit: () => Promise.reject(new Error("Server says no")),
    }),
  );
  await open();
  await page.getByRole("textbox", { name: "Your note" }).fill("A note");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await scan("send error");

  const names = new Set(found.flatMap(([part]) => part?.split(" ") ?? []));
  expect([...names].sort()).toEqual([...PARTS].sort());
});

test("css goes after every default sheet, the dialog's included", async ({ page }) => {
  await mount(page, { css: ".trigger { border-radius: 3px } .title { margin: 9px }" });
  const trigger = page.getByRole("button", { name: "Send feedback" });
  await expect(trigger).toHaveCSS("border-top-left-radius", "3px");
  for (let round = 0; round < 2; round++) {
    await trigger.click();
    const title = page.getByRole("heading", { name: "Send feedback" });
    await expect(title).toHaveCSS("margin-top", "9px");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(title).toHaveCount(0);
  }
});

test("unstyled keeps the layout and drops the look", async ({ page }) => {
  await mount(page, { unstyled: true });
  const trigger = page.getByRole("button", { name: "Send feedback" });
  await expect(trigger).toHaveCSS("position", "fixed");
  await expect(trigger).toHaveCSS("height", "40px");
  await expect(trigger).toHaveCSS("box-shadow", "none");
  await expect(trigger).not.toHaveCSS("border-top-left-radius", "999px");
  await expect(trigger).not.toHaveCSS("font-weight", "600");
  await trigger.click();
  const backdrop = page.getByRole("dialog");
  await expect(backdrop).toHaveCSS("position", "fixed");
  await expect(backdrop).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const panel = page.locator("visual-feedback .dialog");
  await expect(panel).toHaveCSS("display", "grid");
  await expect(panel).toHaveCSS("padding-top", "0px");
  await expect(panel).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(panel).toHaveCSS("box-shadow", "none");
  await page.keyboard.press("Escape");
  await expect(backdrop).toHaveCount(0);
});

test("unstyled keeps the focus ring, on the trigger and in the dialog", async ({ page }) => {
  await mount(page, { unstyled: true });
  // The focus colour as the shadow root resolves it, to compare each ring with.
  const focus = await page.evaluate(() => {
    const root = document.querySelector("visual-feedback")?.shadowRoot;
    const probe = document.createElement("i");
    probe.style.color = "var(--_f)";
    root?.querySelector(".vf")?.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
  expect(focus).not.toBe("rgba(0, 0, 0, 0)");
  const trigger = page.getByRole("button", { name: "Send feedback" });
  // A key press first, so the browser treats the focus as from the keyboard (WebKit skips buttons on Tab).
  await page.keyboard.press("Shift");
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveCSS("outline-style", "solid");
  await expect(trigger).toHaveCSS("outline-width", "2px");
  await expect(trigger).toHaveCSS("outline-color", focus);
  await page.keyboard.press("Enter");
  // The note, whose ring the default look takes away, has it here.
  const note = page.getByRole("textbox", { name: "Your note" });
  await expect(note).toBeFocused();
  await expect(note).toHaveCSS("outline-style", "solid");
  await expect(note).toHaveCSS("outline-color", focus);
  await page.keyboard.press("Tab");
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).toBeFocused();
  await expect(send).toHaveCSS("outline-style", "solid");
  await expect(send).toHaveCSS("outline-width", "2px");
  await expect(send).toHaveCSS("outline-color", focus);
  // Every other control in the dialog too, each focused as from the keyboard.
  const count = await page.evaluate(
    () =>
      [
        ...(document
          .querySelector("visual-feedback")
          ?.shadowRoot?.querySelectorAll<HTMLElement>(
            ".dialog :is(button,textarea,input,select,[tabindex])",
          ) ?? []),
      ].filter((item) => !item.matches(":disabled") && item.getClientRects().length > 0).length,
  );
  expect(count).toBeGreaterThan(8);
  for (let i = 0; i < count; i++) {
    await page.keyboard.press("Shift");
    const ring = await page.evaluate((n) => {
      const item = [
        ...(document
          .querySelector("visual-feedback")
          ?.shadowRoot?.querySelectorAll<HTMLElement>(
            ".dialog :is(button,textarea,input,select,[tabindex])",
          ) ?? []),
      ].filter((control) => !control.matches(":disabled") && control.getClientRects().length > 0)[
        n
      ];
      item?.focus();
      const style = item ? getComputedStyle(item) : undefined;
      return `${item?.className} ${style?.outlineStyle} ${style?.outlineColor}`;
    }, i);
    expect(ring.endsWith(` solid ${focus}`), ring).toBe(true);
  }
});

test("unstyled with css: the css option styles the bare widget", async ({ page }) => {
  await mount(page, {
    unstyled: true,
    css: ".trigger { border-radius: 4px } .dialog { padding: 6px }",
  });
  const trigger = page.getByRole("button", { name: "Send feedback" });
  await expect(trigger).toHaveCSS("border-top-left-radius", "4px");
  await trigger.click();
  await expect(page.locator("visual-feedback .dialog")).toHaveCSS("padding-top", "6px");
});

test("theme forces the colour scheme, and auto follows the system on a page with no background", async ({
  page,
}) => {
  const background = async (theme: string) => {
    await mount(page, { theme });
    const result = await page.evaluate(() => {
      const root = document.querySelector("visual-feedback")?.shadowRoot;
      const wrapper = root?.querySelector(".vf");
      const trigger = root?.querySelector(".trigger");
      return wrapper && trigger
        ? [getComputedStyle(wrapper).colorScheme, getComputedStyle(trigger).backgroundColor]
        : [];
    });
    await page.evaluate(() => (window as unknown as { vf: { destroy(): void } }).vf.destroy());
    return result;
  };
  await page.emulateMedia({ colorScheme: "light" });
  const light = await background("light");
  const dark = await background("dark");
  expect(light[0]).toBe("light");
  expect(dark[0]).toBe("dark");
  expect(light[1]).not.toBe(dark[1]);
  expect((await background("auto"))[1]).toBe(light[1]);
  await page.emulateMedia({ colorScheme: "dark" });
  expect((await background("auto"))[1]).toBe(dark[1]);
});

test("reduced motion turns transitions off", async ({ page }) => {
  await mount(page);
  const trigger = page.getByRole("button", { name: "Send feedback" });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(trigger).toHaveCSS("transition-duration", "0.15s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(trigger).toHaveCSS("transition-duration", "0s");
});

for (const fallback of [false, true]) {
  test(`the focus ring uses the accent${fallback ? ", with the fallback where AccentColor is missing" : ""}`, async ({
    page,
  }) => {
    if (fallback) {
      await page.addInitScript(withoutSupport, "AccentColor");
      await page.goto("/widget/");
    }
    await mount(page);
    const values = await resolved(page);
    expect(values["--vf-accent"]).toBe(fallback ? "#0b57d0" : "AccentColor");
    expect(values["--vf-accent-text"]).toBe("#fff");
    const expected = await page.evaluate(
      (color) => {
        const probe = document.createElement("div");
        probe.style.color = color;
        document.body.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      },
      fallback ? "#0b57d0" : "AccentColor",
    );
    expect(expected).not.toBe("rgba(0, 0, 0, 0)");
    await page.getByRole("button", { name: "Send feedback" }).click();
    await expect(page.getByRole("textbox", { name: "Your note" })).toBeFocused();
    // Tab from the note reaches Send, the next control in the composer.
    await page.keyboard.press("Tab");
    const send = page.getByRole("button", { name: "Send", exact: true });
    await expect(send).toBeFocused();
    await expect(send).toHaveCSS("outline-color", expected);
    await expect(send).toHaveCSS("outline-style", "solid");
  });
}

/** A page styled like a site with a brand: two filled buttons, a dark background. */
async function brand(page: Page, css = "") {
  await page.addStyleTag({
    content: `body { background: rgb(16, 24, 32); color: rgb(240, 240, 240) }
      .brand { background: rgb(228, 0, 124); color: #fff; border: 0; border-radius: 6px; padding: 8px }
      ${css}`,
  });
  await page.evaluate(() => {
    for (const name of ["Buy", "Join"]) {
      const button = document.createElement("button");
      button.className = "brand";
      button.textContent = name;
      document.querySelector("main")?.append(button);
    }
  });
}

/** Send's fill and corner, and the trigger's surface and the scheme inside, once the dialog shows. */
async function look(page: Page) {
  const trigger = page.locator("visual-feedback").locator(".trigger");
  const surface = await trigger.evaluate((element) => getComputedStyle(element).backgroundColor);
  await trigger.click();
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).toBeVisible();
  return {
    surface,
    accent: await send.evaluate((element) => getComputedStyle(element).backgroundColor),
    corner: await send.evaluate((element) => getComputedStyle(element).borderTopLeftRadius),
    scheme: await page.evaluate(
      () =>
        getComputedStyle(
          document.querySelector("visual-feedback")?.shadowRoot?.querySelector(".vf") as Element,
        ).colorScheme,
    ),
  };
}

test("with no --vf-* set, the widget takes the page's accent, corners and background", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await brand(page);
  await mount(page);
  expect(await look(page)).toEqual({
    surface: "rgb(16, 24, 32)",
    accent: "rgb(228, 0, 124)",
    corner: "6px",
    scheme: "dark",
  });
});

test("the page's theme-color comes before its buttons", async ({ page }) => {
  await brand(page);
  await page.evaluate(() => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#1fa463";
    document.head.append(meta);
  });
  await mount(page);
  expect((await look(page)).accent).toBe("rgb(31, 164, 99)");
});

test("a guess that fails contrast keeps the default", async ({ page }) => {
  const probe = (color: string) =>
    page.evaluate((color) => {
      const element = document.createElement("div");
      element.style.color = color;
      document.body.append(element);
      const value = getComputedStyle(element).color;
      element.remove();
      return value;
    }, color);
  await page.emulateMedia({ colorScheme: "light" });
  // Yellow on white is 1.3:1, and grey text on grey is under 4.5:1.
  await brand(
    page,
    `body { background: rgb(200, 200, 200); color: rgb(150, 150, 150) }
    .brand { background: rgb(255, 225, 0) }`,
  );
  await mount(page);
  const found = await look(page);
  expect(found.surface).toBe(await probe("Canvas"));
  const fallback = await page.evaluate(() =>
    CSS.supports("color", "AccentColor") ? "AccentColor" : "#0b57d0",
  );
  expect(found.accent).toBe(await probe(fallback));
  expect(found.scheme).toBe("light dark");
});

test("each --vf-* the host sets wins over what the page shows", async ({ page }) => {
  await brand(page, "visual-feedback { --vf-accent: rgb(1, 2, 3); --vf-radius: 32px }");
  await mount(page);
  const found = await look(page);
  expect(found.accent).toBe("rgb(1, 2, 3)");
  expect(found.corner).toBe("20px");
  // The background was not set by the host, so it still comes from the page.
  expect(found.surface).toBe("rgb(16, 24, 32)");
});

test("the browser's own buttons are not the site's look", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mount(page);
  // The fixture's only button is unstyled: the corners stay 16px, Send's share of it is 10px.
  expect((await look(page)).corner).toBe("10px");
});

test("a forced theme keeps the system colours, and the accent still comes from the page", async ({
  page,
}) => {
  await brand(page);
  await mount(page, { theme: "light" });
  const found = await look(page);
  expect(found.scheme).toBe("light");
  expect(found.surface).not.toBe("rgb(16, 24, 32)");
  expect(found.accent).toBe("rgb(228, 0, 124)");
});

test("the trigger shows the page's colours from the first frame, with no fade", async ({
  page,
}) => {
  await brand(page);
  await mount(page);
  // Read once, at once: a retrying assertion would also pass after a fade.
  const first = await page.evaluate(() => {
    const trigger = document
      .querySelector("visual-feedback")
      ?.shadowRoot?.querySelector(".trigger") as Element;
    return [getComputedStyle(trigger).backgroundColor, trigger.getAnimations().length];
  });
  expect(first).toEqual(["rgb(16, 24, 32)", 0]);
});

test("a page that changes its look after load is read again at the next open", async ({ page }) => {
  await mount(page);
  await brand(page);
  expect((await look(page)).accent).toBe("rgb(228, 0, 124)");
});

test("a draft opened again reads the page again, and Send's text follows the new accent", async ({
  page,
}) => {
  // A dark page with a yellow accent: Send needs black text.
  await page.addStyleTag({
    content: `body { background: rgb(16, 24, 32); color: rgb(240, 240, 240) }
      .brand { background: rgb(255, 212, 0); border: 0; border-radius: 6px; padding: 8px }`,
  });
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.className = "brand";
    button.textContent = "Buy";
    document.querySelector("main")?.append(button);
  });
  await mount(page);
  await page.getByRole("button", { name: "Send feedback" }).click();
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).toHaveAttribute("data-ink", "dark");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open" })).toBeVisible();
  // The site switches to its light look while the draft waits.
  await page.addStyleTag({
    content: `body { background: rgb(255, 255, 255); color: rgb(20, 20, 20) }
      .brand { background: rgb(37, 99, 235) }`,
  });
  await page.getByRole("button", { name: "Open" }).click();
  await expect(send).toHaveCSS("background-color", "rgb(37, 99, 235)");
  await expect(send).not.toHaveAttribute("data-ink");
});

test("update() reads the page again only when the theme changes", async ({ page }) => {
  await mount(page);
  const trigger = page.locator("visual-feedback").locator(".trigger");
  const before = await trigger.evaluate((element) => getComputedStyle(element).backgroundColor);
  await brand(page);
  await page.evaluate(() =>
    (window as unknown as Mounted).vf.update({ strings: { triggerText: "Feedback" } }),
  );
  // Past the trigger's 0.15 s fade, read once: a retry would catch the start of a fade.
  await page.waitForTimeout(300);
  expect(await trigger.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
    before,
  );
  // "light" is a new theme: the page is read again, here its accent, though light keeps the surface.
  await page.evaluate(() => (window as unknown as Mounted).vf.update({ theme: "light" }));
  const accent = await page.evaluate(() =>
    getComputedStyle(
      document.querySelector("visual-feedback")?.shadowRoot?.querySelector(".vf") as Element,
    )
      .getPropertyValue("--_pa")
      .trim(),
  );
  expect(accent).toBe("rgb(228 0 124)");
});

test("the accent is the commonest coloured button, the corners the middle ones, greys aside", async ({
  page,
}) => {
  await page.addStyleTag({
    content: `.a, .b, .grey { border: 0; padding: 8px; color: #fff }
      .a { background: rgb(37, 99, 235); border-radius: 2px }
      .b { background: rgb(220, 38, 38); border-radius: 12px }
      .grey { background: rgb(120, 120, 120); border-radius: 8px }`,
  });
  await page.evaluate(() => {
    for (const name of ["a", "a", "b", "grey", "grey"]) {
      const button = document.createElement("button");
      button.className = name;
      button.textContent = name;
      document.querySelector("main")?.append(button);
    }
  });
  await mount(page);
  const found = await look(page);
  expect(found.accent).toBe("rgb(37, 99, 235)");
  // Radii 2, 2, 8, 8, 12: the middle one is 8.
  expect(found.corner).toBe("8px");
});

test("pills keep the default corners, and links give the accent when no button has one", async ({
  page,
}) => {
  await page.addStyleTag({
    content: `.pill { background: rgb(200, 200, 200); border: 0; border-radius: 999px; padding: 8px 16px }
      a { color: rgb(0, 128, 96) }`,
  });
  await page.evaluate(() => {
    const main = document.querySelector("main");
    for (const name of ["One", "Two"]) {
      const button = document.createElement("button");
      button.className = "pill";
      button.textContent = name;
      main?.append(button);
    }
    const link = document.createElement("a");
    link.href = "#docs";
    link.textContent = "Docs";
    main?.append(link);
  });
  await mount(page);
  const found = await look(page);
  expect(found.corner).toBe("10px");
  expect(found.accent).toBe("rgb(0, 128, 96)");
});

test("a light page under a dark system makes the widget light", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addStyleTag({
    content: "body { background: rgb(250, 250, 250); color: rgb(17, 17, 17) }",
  });
  await mount(page);
  const found = await look(page);
  expect(found.scheme).toBe("light");
  expect(found.surface).toBe("rgb(250, 250, 250)");
});

test("page text under 4.5:1 keeps the default surface, and mid-grey text gets stronger hints", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  // rgb(130, 130, 130) on white is 3.9:1.
  await page.addStyleTag({
    content: "body { background: rgb(255, 255, 255); color: rgb(130, 130, 130) }",
  });
  await mount(page);
  const trigger = page.locator("visual-feedback").locator(".trigger");
  await expect(trigger).not.toHaveCSS("color", "rgb(130, 130, 130)");
  // rgb(118, 118, 118) is 4.5:1: it is taken, and its hints at 60% would fall under, so they take all of it.
  await page.addStyleTag({ content: "body { color: rgb(118, 118, 118) }" });
  await page.evaluate(() => (window as unknown as Mounted).vf.update({ theme: "light" }));
  await page.evaluate(() => (window as unknown as Mounted).vf.update({ theme: "auto" }));
  await expect(trigger).toHaveCSS("color", "rgb(118, 118, 118)");
  await trigger.click();
  const note = page.getByRole("textbox", { name: "Your note" });
  expect(await note.evaluate((element) => getComputedStyle(element, "::placeholder").color)).toBe(
    "rgb(118, 118, 118)",
  );
});

test("a --vf-surface set through the css option keeps the page's text out", async ({ page }) => {
  await brand(page);
  await mount(page, { css: ".vf { --vf-surface: rgb(250, 250, 250) }" });
  const trigger = page.locator("visual-feedback").locator(".trigger");
  await expect(trigger).toHaveCSS("background-color", "rgb(250, 250, 250)");
  await expect(trigger).not.toHaveCSS("color", "rgb(240, 240, 240)");
  // The page is still read: its accent is taken.
  expect((await look(page)).accent).toBe("rgb(228, 0, 124)");
});

test("with a forced theme the accent must contrast with the system background, not the page's", async ({
  page,
}) => {
  // Yellow passes 3:1 on this dark page, but not on the light system background theme forces.
  await brand(page, ".brand { background: rgb(255, 225, 0) }");
  await mount(page, { theme: "light" });
  expect((await look(page)).accent).not.toBe("rgb(255, 225, 0)");
});

test("a theme-color for the page's light or dark is taken only in that scheme", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => {
    for (const [media, color] of [
      ["(prefers-color-scheme: light)", "#1fa463"],
      ["(prefers-color-scheme: dark)", "#a78bfa"],
    ]) {
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.setAttribute("media", media ?? "");
      meta.content = color ?? "";
      document.head.append(meta);
    }
  });
  await mount(page);
  expect((await look(page)).accent).toBe("rgb(167, 139, 250)");
});

test("a new theme while the dialog is open picks Send's text again", async ({ page }) => {
  // Yellow passes 3:1 on this dark page, so Send is yellow with black text.
  await brand(page, ".brand { background: rgb(255, 225, 0) }");
  await mount(page);
  await page.getByRole("button", { name: "Send feedback" }).click();
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).toHaveAttribute("data-ink", "dark");
  // Forced light, yellow fails against the light background: the default accent takes white text.
  await page.evaluate(() => (window as unknown as Mounted).vf.update({ theme: "light" }));
  await expect(send).not.toHaveCSS("background-color", "rgb(255, 225, 0)");
  const ink = await send.evaluate((element) => element.dataset.ink);
  const fill = await send.evaluate((element) => getComputedStyle(element).backgroundColor);
  // Black text only where it contrasts more than white on the new accent (WCAG luminance).
  const [r = 0, g = 0, b = 0] = (fill.match(/\d+/g) ?? []).map(Number);
  const linear = (c: number) =>
    c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4;
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  expect(ink === "dark").toBe((luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05));
});

test("a site that lets the browser pick light or dark keeps the default corners", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addStyleTag({ content: ":root { color-scheme: light dark }" });
  await mount(page);
  expect((await look(page)).corner).toBe("10px");
});

test("css given later through update() that sets --vf-surface drops the page's text", async ({
  page,
}) => {
  await brand(page);
  await mount(page);
  const trigger = page.locator("visual-feedback").locator(".trigger");
  await expect(trigger).toHaveCSS("color", "rgb(240, 240, 240)");
  await page.evaluate(() =>
    (window as unknown as Mounted).vf.update({ css: ".vf { --vf-surface: rgb(250, 250, 250) }" }),
  );
  // Light page text on the host's light surface would be unreadable.
  await expect(trigger).toHaveCSS("background-color", "rgb(250, 250, 250)");
  await expect(trigger).not.toHaveCSS("color", "rgb(240, 240, 240)");
});

test("a host that sets only --vf-text keeps the default surface, not the page's", async ({
  page,
}) => {
  await brand(page, "visual-feedback { --vf-text: rgb(10, 10, 10) }");
  await mount(page);
  const trigger = page.locator("visual-feedback").locator(".trigger");
  await expect(trigger).toHaveCSS("color", "rgb(10, 10, 10)");
  // The page's dark background under the host's near-black text would be unreadable.
  await expect(trigger).not.toHaveCSS("background-color", "rgb(16, 24, 32)");
  // The page is still read: its accent is taken.
  expect((await look(page)).accent).toBe("rgb(228, 0, 124)");
});
