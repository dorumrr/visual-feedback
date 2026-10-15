import { expect, type Page, test } from "@playwright/test";
import { markdown } from "../recipes/doc";
import { confirmed, failable, type Mounted, mount, withoutSupport } from "./widget";

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
  await expect(trigger).toHaveCSS("color", await probe("Canvas"));
  await expect(trigger).toHaveCSS("background-color", await probe("CanvasText"));
  await expect(trigger).toHaveCSS("box-shadow", "rgba(0, 0, 0, 0.35) 0px 12px 32px -12px");
  await expect(trigger).toHaveCSS("z-index", "2147483000");
  // Filled in the text colour, so it stands out on any page with no border.
  await expect(trigger).toHaveCSS("border-top-width", "0px");
  await trigger.click();
  const panel = page.locator("visual-feedback .dialog");
  const backdrop = page.getByRole("dialog");
  const note = page.getByRole("textbox", { name: "Your note" });
  const muted = () => note.evaluate((element) => getComputedStyle(element, "::placeholder").color);
  const composer = page.locator("visual-feedback .composer");

  await expect(panel).toHaveCSS("border-top-left-radius", "16px");
  await expect(backdrop).toHaveCSS("background-color", "rgba(0, 0, 0, 0.45)");
  await expect(page.locator("visual-feedback .toolbar")).toHaveCSS(
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
  await expect(trigger).toHaveCSS("color", "rgb(1, 2, 3)");
  await expect(trigger).toHaveCSS("background-color", "rgb(4, 5, 6)");
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
  const { width = 0, height = 0 } = page.viewportSize() ?? {};
  const gaps = async () => {
    const box = await trigger.boundingBox();
    expect(box?.height).toBe(50);
    return [width - (box?.x ?? 0) - (box?.width ?? 0), height - (box?.y ?? 0) - (box?.height ?? 0)];
  };
  // The tab stays on the edge: the offset lifts it along it, and rounds its end side.
  expect((await gaps()).map(Math.round)).toEqual([0, 40]);
  // Ends where it began, for the button below.
  for (const position of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
    await page.evaluate(
      (position) => (window as unknown as Mounted).vf.update({ position: position as never }),
      position,
    );
    const [y, x] = position.split("-") as ["top" | "bottom", "left" | "right"];
    const inner = x === "right" ? "left" : "right";
    const box = await trigger.boundingBox();
    const fromX = x === "left" ? (box?.x ?? -1) : width - (box?.x ?? 0) - (box?.width ?? 0);
    const fromY = y === "top" ? (box?.y ?? -1) : height - (box?.y ?? 0) - (box?.height ?? 0);
    expect([fromX, fromY].map(Math.round), position).toEqual([0, 40]);
    await expect(trigger, position).not.toHaveCSS(`border-${y}-${inner}-radius`, "0px");
    await expect(trigger, position).toHaveCSS(`border-${y}-${x}-radius`, "0px");
  }
  await page.evaluate(() => (window as unknown as Mounted).vf.update({ trigger: "button" }));
  expect((await gaps()).map(Math.round)).toEqual([40, 40]);
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
  await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
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
  await confirmed(page);
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
  await expect(trigger).not.toHaveCSS("font-weight", "600");
  // The tooltip's hiding is layout too: hidden at rest, shown on hover.
  const tip = page.locator("visual-feedback").locator(".tip");
  await expect(tip).toBeHidden();
  await trigger.hover();
  await expect(tip).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(tip).toBeHidden();
  // Still on the edge, the tab's place being layout.
  const box = await trigger.boundingBox();
  expect(Math.round((page.viewportSize()?.width ?? 0) - (box?.x ?? 0) - (box?.width ?? 0))).toBe(0);
  // No border or corners of its own: those a plain button has on this page, on every side.
  const [own, plain] = await trigger.evaluate((element) => {
    const border = (target: Element) => {
      const style = getComputedStyle(target);
      const sides = ["top", "right", "left"].flatMap((side) =>
        ["width", "style", "color"].map((what) => style.getPropertyValue(`border-${side}-${what}`)),
      );
      return [...sides, style.borderTopLeftRadius, style.borderTopRightRadius];
    };
    const button = document.createElement("button");
    document.body.append(button);
    const result = [border(element), border(button)];
    button.remove();
    return result;
  });
  expect(own).toEqual(plain);
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
        ? [getComputedStyle(wrapper).colorScheme, getComputedStyle(trigger).color]
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
  const tip = page.locator("visual-feedback").locator(".tip");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(trigger).toHaveCSS("transition-duration", "0.15s, 0.15s");
  await expect(tip).toHaveCSS("transition-duration", "0.15s, 0.15s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(trigger).toHaveCSS("transition-duration", "0s");
  await expect(tip).toHaveCSS("transition-duration", "0s");
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
  const surface = await trigger.evaluate((element) => getComputedStyle(element).color);
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
  // The trigger's fill takes the page's text colour, not its accent.
  await expect(page.locator("visual-feedback").locator(".trigger")).toHaveCSS(
    "background-color",
    "rgb(240, 240, 240)",
  );
  expect(await look(page)).toEqual({
    surface: "rgb(16, 24, 32)",
    accent: "rgb(228, 0, 124)",
    corner: "6px",
    scheme: "dark",
  });
});

test("the trigger is filled with the text colour, its flag in the surface colour, and swaps them on hover", async ({
  page,
}) => {
  await page.addStyleTag({
    content: "visual-feedback { --vf-surface: rgb(250, 240, 230); --vf-text: rgb(20, 30, 40) }",
  });
  await mount(page);
  const trigger = page.locator("visual-feedback").locator(".trigger");
  const icon = trigger.locator(":scope > svg");
  await expect(icon).toHaveAttribute("part", "trigger-icon");
  const color = await trigger.evaluate((element) => getComputedStyle(element).color);
  await expect(icon).toHaveCSS("fill", color);
  await expect(icon).toHaveCSS("stroke", "none");
  // A pole and its cloth: one path, drawn by its fill alone.
  expect(await icon.locator("path").getAttribute("d")).toMatch(/^(?:[^M]*M){2}[^M]*$/);
  // Centred, at 62.5% of its width.
  const [box, inner] = await Promise.all([
    icon.boundingBox(),
    trigger.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const [top, right, bottom, left] = ["top", "right", "bottom", "left"].map((side) =>
        Number.parseFloat(style.getPropertyValue(`border-${side}-width`)),
      ) as [number, number, number, number];
      const width = rect.width - left - right;
      return {
        x: rect.x + left + width / 2,
        y: rect.y + top + (rect.height - top - bottom) / 2,
        size: width * 0.625,
      };
    }),
  ]);
  if (!box) throw new Error("no icon");
  expect(Math.abs(box.x + box.width / 2 - inner.x)).toBeLessThan(1);
  expect(Math.abs(box.y + box.height / 2 - inner.y)).toBeLessThan(1);
  expect(Math.abs(box.width - inner.size)).toBeLessThan(1);
  expect(color).toBe("rgb(250, 240, 230)");
  await expect(trigger).toHaveCSS("background-color", "rgb(20, 30, 40)");
  await expect(trigger).toHaveCSS("border-top-width", "0px");
  await trigger.hover();
  await expect(trigger).toHaveCSS("background-color", "rgb(250, 240, 230)");
  await expect(icon).toHaveCSS("fill", "rgb(20, 30, 40)");
  await page.mouse.move(0, 0);
  await expect(icon).toHaveCSS("fill", color);
  await expect(trigger).toHaveCSS("background-color", "rgb(20, 30, 40)");
  // A label swaps with the icon.
  await page.evaluate(() =>
    (window as unknown as Mounted).vf.update({ strings: { triggerText: "Feedback" } }),
  );
  const label = trigger.locator('[part="trigger-text"]');
  await expect(label).toHaveCSS("color", "rgb(250, 240, 230)");
  await trigger.hover();
  await expect(label).toHaveCSS("color", "rgb(20, 30, 40)");
});

test("with a label, the trigger keeps a small icon beside it", async ({ page }) => {
  await mount(page, { strings: { triggerText: "Feedback" } });
  const icon = page.locator("visual-feedback").locator(".trigger > svg");
  const [width, size] = await icon.evaluate((element) =>
    [getComputedStyle(element).width, getComputedStyle(element).fontSize].map(Number.parseFloat),
  );
  expect(width).toBeCloseTo((size ?? 0) * 1.15, 1);
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
    return [getComputedStyle(trigger).color, trigger.getAnimations().length];
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
  const before = await trigger.evaluate((element) => getComputedStyle(element).color);
  await brand(page);
  await page.evaluate(() =>
    (window as unknown as Mounted).vf.update({ strings: { triggerText: "Feedback" } }),
  );
  // Past the trigger's 0.15 s fade, read once: a retry would catch the start of a fade.
  await page.waitForTimeout(300);
  expect(await trigger.evaluate((element) => getComputedStyle(element).color)).toBe(before);
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
  await expect(trigger).not.toHaveCSS("background-color", "rgb(130, 130, 130)");
  // rgb(118, 118, 118) is 4.5:1: it is taken, and its hints at 60% would fall under, so they take all of it.
  await page.addStyleTag({ content: "body { color: rgb(118, 118, 118) }" });
  await page.evaluate(() => (window as unknown as Mounted).vf.update({ theme: "light" }));
  await page.evaluate(() => (window as unknown as Mounted).vf.update({ theme: "auto" }));
  await expect(trigger).toHaveCSS("background-color", "rgb(118, 118, 118)");
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
  await expect(trigger).toHaveCSS("color", "rgb(250, 250, 250)");
  await expect(trigger).not.toHaveCSS("background-color", "rgb(240, 240, 240)");
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
  await expect(trigger).toHaveCSS("background-color", "rgb(240, 240, 240)");
  await page.evaluate(() =>
    (window as unknown as Mounted).vf.update({ css: ".vf { --vf-surface: rgb(250, 250, 250) }" }),
  );
  // Light page text on the host's light surface would be unreadable.
  await expect(trigger).toHaveCSS("color", "rgb(250, 250, 250)");
  await expect(trigger).not.toHaveCSS("background-color", "rgb(240, 240, 240)");
});

test("a host that sets only --vf-text keeps the default surface, not the page's", async ({
  page,
}) => {
  await brand(page, "visual-feedback { --vf-text: rgb(10, 10, 10) }");
  await mount(page);
  const trigger = page.locator("visual-feedback").locator(".trigger");
  await expect(trigger).toHaveCSS("background-color", "rgb(10, 10, 10)");
  // The page's dark background under the host's near-black text would be unreadable.
  await expect(trigger).not.toHaveCSS("color", "rgb(16, 24, 32)");
  // The page is still read: its accent is taken.
  expect((await look(page)).accent).toBe("rgb(228, 0, 124)");
});

const NIGHT = `body { background: rgb(255, 255, 255); color: rgb(20, 20, 20) }
  .brand { background: rgb(200, 0, 90); color: #fff; border: 0; border-radius: 6px; padding: 8px }
  html.night body { background: rgb(16, 24, 32); color: rgb(240, 240, 240) }
  html.night .brand { background: rgb(255, 140, 190) }`;

/** The page's own buttons, in a site with a day look and a night look set by a class on <html>. */
async function nightSite(page: Page) {
  await page.addStyleTag({ content: NIGHT });
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.className = "brand";
    button.textContent = "Buy";
    document.querySelector("main")?.append(button);
  });
}

/** Switches the class, then reads once in the next frame: no retry, so a fade would show. */
function night(page: Page, on: boolean, selector: string) {
  return page.evaluate(
    async ([on, selector]) => {
      document.documentElement.classList.toggle("night", on as boolean);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const element = document
        .querySelector("visual-feedback")
        ?.shadowRoot?.querySelector(selector as string) as HTMLElement;
      return {
        background: getComputedStyle(element).backgroundColor,
        fading: element.getAnimations().length,
        ink: element.dataset.ink ?? "",
      };
    },
    [on, selector],
  );
}

test("a theme switch on <html> reaches the trigger, the open panel and the draft bar at once", async ({
  page,
}) => {
  await nightSite(page);
  await mount(page);
  await expect(page.locator("visual-feedback").locator(".trigger")).toHaveCSS(
    "color",
    "rgb(255, 255, 255)",
  );
  // Its fill is the night text colour.
  expect(await night(page, true, ".trigger")).toEqual({
    background: "rgb(240, 240, 240)",
    fading: 0,
    ink: "",
  });

  await page.getByRole("button", { name: "Send feedback" }).click();
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).toHaveCSS("background-color", "rgb(255, 140, 190)");
  await expect(send).toHaveAttribute("data-ink", "dark");
  // Back to day while the panel is open: its surface, the accent and the text on it follow.
  expect((await night(page, false, ".dialog")).background).toBe("rgb(255, 255, 255)");
  expect(await night(page, false, ".send")).toEqual({
    background: "rgb(200, 0, 90)",
    fading: 0,
    ink: "",
  });

  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open" })).toBeVisible();
  expect((await night(page, true, ".draft")).background).toBe("rgb(16, 24, 32)");
});

test("a change of the system's light or dark reaches the widget with no attribute changed", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addStyleTag({
    content: `body { background: rgb(255, 255, 255); color: rgb(20, 20, 20) }
      @media (prefers-color-scheme: dark) { body { background: rgb(16, 24, 32); color: rgb(240, 240, 240) } }`,
  });
  await mount(page);
  const trigger = page.locator("visual-feedback").locator(".trigger");
  await expect(trigger).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(trigger).toHaveCSS("color", "rgb(16, 24, 32)");
});

test("a <body> made after the widget is watched: its theme switch reaches the trigger", async ({
  page,
}) => {
  await page.evaluate(() => document.body.remove());
  await mount(page);
  await page.addStyleTag({ content: NIGHT });
  await page.evaluate(() => document.documentElement.append(document.createElement("body")));
  const trigger = page.locator("visual-feedback").locator(".trigger");
  await expect(trigger).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.evaluate(() => document.documentElement.classList.add("night"));
  await expect(trigger).toHaveCSS("color", "rgb(16, 24, 32)");
  // A <body> put in place of the old one: its own attributes are watched.
  await page.evaluate(() => {
    document.documentElement.classList.remove("night");
    const next = document.createElement("body");
    document.body.replaceWith(next);
  });
  await expect(trigger).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.evaluate(() => {
    document.body.style.background = "rgb(16, 24, 32)";
    document.body.style.color = "rgb(240, 240, 240)";
  });
  await expect(trigger).toHaveCSS("color", "rgb(16, 24, 32)");
});

test("an attribute change that leaves the page's colours alone does not read the page", async ({
  page,
}) => {
  await nightSite(page);
  await mount(page);
  const scans = () =>
    page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return (window as unknown as { scans: number }).scans;
    });
  await page.evaluate(() => {
    const w = window as unknown as { scans: number };
    w.scans = 0;
    const { querySelectorAll } = Document.prototype;
    Document.prototype.querySelectorAll = function (this: Document, selector: string) {
      if (selector.includes('[role="button"]')) w.scans++;
      return querySelectorAll.call(this, selector);
    } as typeof querySelectorAll;
  });
  // The scroll lock's own write, and a data attribute, as a router or an analytics tag would set.
  await page.evaluate(() => {
    document.documentElement.style.overflow = "hidden";
    document.body.dataset.route = "settings";
    document.documentElement.style.overflow = "";
  });
  expect(await scans()).toBe(0);
  await page.evaluate(() => document.documentElement.classList.add("night"));
  expect(await scans()).toBe(1);
});

test("a theme switch the site fades in reaches the widget once the fade ends", async ({ page }) => {
  await nightSite(page);
  await page.addStyleTag({
    content: "body, .brand { transition: background-color .3s, color .3s }",
  });
  await mount(page);
  const trigger = page.locator("visual-feedback").locator(".trigger");
  await expect(trigger).toHaveCSS("color", "rgb(255, 255, 255)");
  // The site's fade runs: what the widget would read now is the old colour.
  const fading = await page.evaluate(() => {
    document.documentElement.classList.add("night");
    return document.body.getAnimations().length;
  });
  expect(fading).toBeGreaterThan(0);
  await expect(trigger).toHaveCSS("color", "rgb(16, 24, 32)");
  await page.getByRole("button", { name: "Send feedback" }).click();
  // The buttons fade too: the accent is the one they end on.
  await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveCSS(
    "background-color",
    "rgb(255, 140, 190)",
  );
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.documentElement.classList.remove("night"));
  await expect(page.locator("visual-feedback").locator(".draft")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
});

test("an element off the page keeps its colours through a switch, and reads the page when put back", async ({
  page,
}) => {
  await nightSite(page);
  await page.addStyleTag({ content: "body { background: rgb(250, 240, 230) }" });
  await mount(page);
  const trigger = page.locator("visual-feedback").locator(".trigger");
  await expect(trigger).toHaveCSS("color", "rgb(250, 240, 230)");
  const surface = () =>
    page.evaluate(() => {
      const host = (window as unknown as { host: Element }).host;
      const wrapper = host.shadowRoot?.querySelector(".vf") as HTMLElement;
      return wrapper.style.getPropertyValue("--_ps");
    });
  await page.evaluate(() => {
    const w = window as unknown as { host: Element };
    w.host = document.querySelector("visual-feedback") as Element;
    w.host.remove();
    document.documentElement.classList.add("night");
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  expect(await surface()).toBe("rgb(250 240 230)");
  await page.evaluate(() => document.body.append((window as unknown as { host: Element }).host));
  await expect(trigger).toHaveCSS("color", "rgb(16, 24, 32)");
});

test("a page that keeps starting colour fades elsewhere still gets read after a switch", async ({
  page,
}) => {
  await nightSite(page);
  await page.addStyleTag({ content: ".ticker { transition: color 1s }" });
  await mount(page);
  // A cell that changes colour every 100 ms, so some fade always runs.
  await page.evaluate(() => {
    const ticker = document.createElement("p");
    ticker.className = "ticker";
    ticker.textContent = "+0.4%";
    document.querySelector("main")?.append(ticker);
    let up = false;
    setInterval(() => {
      up = !up;
      ticker.style.color = up ? "rgb(0, 160, 0)" : "rgb(200, 0, 0)";
    }, 100);
  });
  await page.evaluate(() => document.documentElement.classList.add("night"));
  await expect(page.locator("visual-feedback").locator(".trigger")).toHaveCSS(
    "color",
    "rgb(16, 24, 32)",
  );
});

test("a system switch while the element is off the page is read when it is put back", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  // No page colours: the widget's background is the system's, and this accent contrasts only
  // with a dark one.
  await page.addStyleTag({
    content: `html, body { background: transparent !important; color: rgb(20, 20, 20) !important }
      .brand { background: rgb(230, 180, 0); border: 0; border-radius: 6px; padding: 8px }`,
  });
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.className = "brand";
    button.textContent = "Buy";
    document.querySelector("main")?.append(button);
  });
  await mount(page);
  const accent = () =>
    page.evaluate(() => {
      const host =
        document.querySelector("visual-feedback") ?? (window as unknown as { host: Element }).host;
      const wrapper = host.shadowRoot?.querySelector(".vf") as HTMLElement;
      return wrapper.style.getPropertyValue("--_pa");
    });
  expect(await accent()).toBe("initial");
  await page.evaluate(() => {
    const w = window as unknown as { host: Element; switched: boolean };
    w.host = document.querySelector("visual-feedback") as Element;
    w.host.remove();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      w.switched = true;
    });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  // The switch reaches the page while the element is still off it.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { switched?: boolean }).switched))
    .toBe(true);
  await page.evaluate(() => document.body.append((window as unknown as { host: Element }).host));
  await expect.poll(accent).toBe("rgb(230 180 0)");
});
