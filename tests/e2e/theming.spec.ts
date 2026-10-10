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
  const trigger = page.getByRole("button", { name: "Send feedback" });
  await trigger.click();
  const panel = page.locator("visual-feedback .dialog");
  const backdrop = page.getByRole("dialog");
  const note = page.getByRole("textbox", { name: "Your note" });
  const muted = () => note.evaluate((element) => getComputedStyle(element, "::placeholder").color);

  await expect(trigger).toHaveCSS("background-color", await probe("Canvas"));
  await expect(trigger).toHaveCSS("color", await probe("CanvasText"));
  await expect(trigger).toHaveCSS("box-shadow", "rgba(0, 0, 0, 0.12) 0px 4px 16px 0px");
  await expect(trigger).toHaveCSS("z-index", "2147483000");
  await expect(panel).toHaveCSS("border-top-left-radius", "12px");
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
  await expect(panel).toHaveCSS("color", "rgb(4, 5, 6)");
  await expect(note).toHaveCSS("border-top-color", "rgb(7, 8, 9)");
  await expect(panel).toHaveCSS("box-shadow", "rgb(10, 11, 12) 1px 2px 3px 0px");
  await expect(panel).toHaveCSS("border-top-left-radius", "5px");
  await expect(note).toHaveCSS("border-top-left-radius", "2.5px");
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCSS(
    "border-top-left-radius",
    "2.5px",
  );
  await expect(backdrop).toHaveCSS("background-color", "rgb(13, 14, 15)");
  expect(await muted()).toBe("rgb(16, 17, 18)");
  await expect(note).toBeFocused();
  await page.keyboard.press("Tab");
  const cancel = page.getByRole("button", { name: "Cancel" });
  await expect(cancel).toHaveCSS("outline-color", "rgb(19, 20, 21)");
  await page.addStyleTag({ content: "visual-feedback { --vf-focus: rgb(22, 23, 24) }" });
  await expect(cancel).toHaveCSS("outline-color", "rgb(22, 23, 24)");
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
  const width = page.viewportSize()?.width ?? 0;
  expect([box?.width, box?.height]).toEqual([50, 50]);
  expect(Math.round(width - (box?.x ?? 0) - (box?.width ?? 0))).toBe(40);
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
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await scan("note required");
  await page.getByRole("textbox", { name: "Your note" }).fill("A note");
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
    await page.keyboard.press("Escape");
    await expect(title).toHaveCount(0);
  }
});

test("unstyled keeps the layout and drops the look", async ({ page }) => {
  await mount(page, { unstyled: true });
  const trigger = page.getByRole("button", { name: "Send feedback" });
  await expect(trigger).toHaveCSS("position", "fixed");
  await expect(trigger).toHaveCSS("width", "36px");
  await expect(trigger).toHaveCSS("box-shadow", "none");
  await expect(trigger).not.toHaveCSS("border-top-left-radius", "50%");
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

test("theme forces the colour scheme, and auto follows the system", async ({ page }) => {
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
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Cancel" })).toHaveCSS("outline-color", expected);
    await expect(page.getByRole("button", { name: "Cancel" })).toHaveCSS("outline-style", "solid");
  });
}
