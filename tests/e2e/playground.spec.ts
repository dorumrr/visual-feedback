import { expect, type Page, test } from "@playwright/test";
import { stored, withoutSupport } from "./widget";

test("the playground loads the built package and shows a report", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Widget loaded. Use the feedback button.");
  await expect(page.getByRole("button", { name: "Send feedback" })).toBeVisible();

  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 40;
    canvas.height = 20;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.fillRect(0, 0, 40, 20);
    const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    const show = (window as unknown as { playground: { show(report: object): void } }).playground
      .show;
    show({
      id: "r1",
      note: "The save button does nothing",
      category: "bug",
      screenshots: [
        {
          image,
          marks: [{ tool: "box", x: 1, y: 2, width: 30, height: 10 }],
          page: { url: "https://example.test/settings?tab=2", title: "Settings" },
        },
        { image, marks: [], page: { url: "https://example.test/other", title: "Other" } },
      ],
      page: { url: "https://example.test/other", title: "Other" },
      context: {},
    });
  });

  const report = page.locator(".report");
  await expect(report.getByRole("heading", { name: "The save button does nothing" })).toBeVisible();
  await expect(report.getByRole("img", { name: "Screenshot 1" })).toBeVisible();
  await expect(report.getByRole("img", { name: "Screenshot 2" })).toBeVisible();
  await expect(
    report.getByRole("link", { name: /Download screenshot 2 \(image\/png/ }),
  ).toHaveAttribute("download", "r1-1.png");
  const details = report.locator("pre");
  await expect(details).toContainText('"category": "bug"');
  await expect(details).toContainText('"tool": "box"');
  await expect(details).toContainText("https://example.test/settings?tab=2");
  await expect(page.locator("#empty")).toBeHidden();
  // The report opened the panel and counts it.
  await expect(page.getByRole("button", { name: /Reports/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.locator("#reports-count")).toHaveText("1");
});

test("the site's own page is the playground: a video site at / with its styles and a planted bug", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/visual-feedback playground/);
  await expect(page.getByRole("status")).toHaveText("Widget loaded. Use the feedback button.");
  // Its stylesheet loaded at /: the cards form a grid.
  await expect(page.getByRole("region", { name: "Videos" })).toHaveCSS("display", "grid");
  await expect(page.locator(".video")).toHaveCount(12);
  const chips = page.getByRole("list", { name: "Topics" }).getByRole("listitem");
  await expect(chips).toHaveText(["For you", ...Array(7).fill("Undefined")]);
  // The reports stay out of the way until asked for.
  const panel = page.getByRole("complementary", { name: "Reports" });
  await expect(panel).toBeHidden();
  const toggle = page.getByRole("button", { name: /Reports/ });
  await toggle.click();
  await expect(panel).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Close reports" }).click();
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("in the playground, the logo sits in the top row, left of the search, at every width", async ({
  page,
}) => {
  await page.goto("/");
  for (const width of [2200, 1380, 901, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const brand = await page.getByRole("link", { name: "SomeTube home" }).boundingBox();
    const search = await page.locator(".top .search").boundingBox();
    if (!brand || !search) throw new Error("no header");
    expect(
      Math.abs(brand.y + brand.height / 2 - (search.y + search.height / 2)),
      `${width}`,
    ).toBeLessThan(2);
    expect(brand.x + brand.width, `${width}`).toBeLessThanOrEqual(search.x);
  }
});

test("in the playground, the trigger captures the page and Send shows the report", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await page.getByRole("textbox", { name: "Your note" }).fill("From the playground");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const report = page.locator(".report");
  await expect(report.getByRole("heading", { name: "From the playground" })).toBeVisible();
  await expect(report.getByRole("img", { name: "Screenshot 1" })).toBeVisible();
  await expect(report.locator("pre")).toContainText('"marks": []');
});

/** Records whether the hint was still shown each time the widget started to capture the page. */
async function watchCapture(page: Page): Promise<() => Promise<boolean[] | undefined>> {
  await page.evaluate(() => {
    const wrapper = document.querySelector("visual-feedback")?.shadowRoot?.querySelector(".vf");
    const hint = document.querySelector<HTMLElement>("#hint");
    if (!wrapper || !hint) throw new Error("no widget or no hint");
    const seen: boolean[] = [];
    (window as unknown as { shownAtCapture: boolean[] }).shownAtCapture = seen;
    new MutationObserver(() => {
      if (wrapper.classList.contains("capturing")) seen.push(hint.checkVisibility());
    }).observe(wrapper, { attributes: true, attributeFilter: ["class"] });
  });
  return () =>
    page.evaluate(() => (window as unknown as { shownAtCapture?: boolean[] }).shownAtCapture);
}

test("in the playground, a looping Click here hint with an arrow points at the trigger", async ({
  page,
}) => {
  await page.goto("/");
  const hint = page.locator("#hint");
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText("Click here");
  await expect(hint.locator("svg")).toBeVisible();
  await expect(hint).toHaveAttribute("aria-hidden", "true");
  await expect(hint).toHaveCSS("pointer-events", "none");
  await expect(hint).toHaveCSS("animation-name", /hint-nudge/);
  await expect(hint).toHaveCSS("animation-iteration-count", /infinite/);
  // It sits just left of the trigger, centred on it.
  const trigger = page.getByRole("button", { name: "Send feedback" });
  const [h, t] = [await hint.boundingBox(), await trigger.boundingBox()];
  if (!h || !t) throw new Error("no box");
  // The tab sits in the corner.
  expect(Math.round((page.viewportSize()?.height ?? 0) - (t.y + t.height))).toBe(0);
  expect(t.x - (h.x + h.width)).toBeGreaterThanOrEqual(0);
  expect(t.x - (h.x + h.width)).toBeLessThan(24);
  expect(Math.abs(h.y + h.height / 2 - (t.y + t.height / 2))).toBeLessThan(4);
  // A click on it reaches the page under it.
  const under = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x ?? 0, y ?? 0)?.closest("#hint") === null,
    [h.x + h.width / 2, h.y + h.height / 2],
  );
  expect(under).toBe(true);
});

test("in the playground, hovering the trigger swaps the Click here hint for its tooltip, in the same style", async ({
  page,
}) => {
  await page.goto("/");
  const hint = page.locator("#hint");
  const tip = page.locator("visual-feedback").locator(".tip");
  await expect(hint).toHaveCSS("opacity", "1");
  await page.getByRole("button", { name: "Send feedback" }).hover();
  await expect(tip).toHaveCSS("opacity", "1");
  await expect(hint).toHaveCSS("opacity", "0");
  const look = (element: Element) => {
    const style = getComputedStyle(element);
    const arrow = Math.round(
      (element.querySelector("svg")?.getBoundingClientRect().width ?? 0) * 10,
    );
    const box = element.getBoundingClientRect().height;
    const { backgroundImage, color, borderRadius, padding, fontWeight, fontSize, boxShadow } =
      style;
    return [
      backgroundImage,
      color,
      borderRadius,
      padding,
      fontWeight,
      fontSize,
      boxShadow,
      box,
      arrow,
    ];
  };
  expect(await tip.evaluate(look)).toEqual(await hint.evaluate(look));
  await page.mouse.move(0, 0);
  await expect(hint).toHaveCSS("opacity", "1");
  await expect(tip).toHaveCSS("opacity", "0");
  // Reached by the keyboard, the tooltip shows and the hint goes the same way.
  await page.keyboard.press("Shift");
  await page.getByRole("button", { name: "Send feedback" }).focus();
  await expect(tip).toHaveCSS("opacity", "1");
  await expect(hint).toHaveCSS("opacity", "0");
});

for (const [how, open] of [
  ["a click", (page: Page) => page.getByRole("button", { name: "Send feedback" }).click()],
  [
    "the keyboard",
    async (page: Page) => {
      await page.getByRole("button", { name: "Send feedback" }).focus();
      await page.keyboard.press("Enter");
    },
  ],
] as const) {
  test(`in the playground, opening the widget with ${how} hides the hint before the screenshot, for the rest of the page load`, async ({
    page,
  }) => {
    await page.goto("/");
    const hint = page.locator("#hint");
    await expect(hint).toBeVisible();
    const shown = await watchCapture(page);
    await open(page);
    await expect(page.locator("visual-feedback").locator(".image")).toBeVisible();
    expect(await shown()).toEqual([false]);
    await expect(hint).toBeHidden();
    await page.getByRole("button", { name: "Keep as draft" }).click();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByRole("button", { name: "Send feedback" })).toBeVisible();
    await expect(hint).toBeHidden();
  });
}

test("in the playground on a phone, the hint sits above the trigger, clear of the status line", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Widget loaded. Use the feedback button.");
  const [h, t, s] = await Promise.all(
    [
      page.locator("#hint"),
      page.getByRole("button", { name: "Send feedback" }),
      page.getByRole("status"),
    ].map((locator) => locator.boundingBox()),
  );
  if (!h || !t || !s) throw new Error("no box");
  expect(t.y - (h.y + h.height)).toBeGreaterThanOrEqual(0);
  expect(t.y - (h.y + h.height)).toBeLessThan(24);
  // Its arrow, at its right end, is over the trigger.
  expect(h.x + h.width).toBeGreaterThan(t.x + t.width / 2);
  expect(h.x + h.width).toBeLessThanOrEqual(t.x + t.width + 1);
  expect(h.x >= s.x + s.width || h.y + h.height <= s.y, "the hint overlaps the status line").toBe(
    true,
  );
});

test("in the playground, the hint goes when a kept draft comes back after a page load", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await page.getByRole("button", { name: "Keep as draft" }).click();
  // The reload must not cut off the draft's write.
  await expect.poll(() => stored(page)).toBe(1);
  await page.reload();
  // The status is set in the same task that would show the hint, so this check comes after it.
  await expect(page.getByRole("status")).toHaveText("Widget loaded. Use the feedback button.");
  await expect(page.getByRole("button", { name: "Discard" })).toBeVisible();
  await expect(page.locator("#hint")).toBeHidden();
});

test("in the playground, the hint does not show where the widget is not supported", async ({
  page,
}) => {
  await page.addInitScript(withoutSupport, "color-mix");
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Widget loaded. Use the feedback button.");
  await expect(page.getByRole("button", { name: "Send feedback" })).toHaveCount(0);
  await expect(page.locator("#hint")).toBeHidden();
});

test("in the playground, the hint keeps still under reduced motion, and does not show when the widget fails to load", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("#hint")).toBeVisible();
  await expect(page.locator("#hint")).toHaveCSS("animation-name", "none");

  await page.route("**/dist/index.mjs", (route) => route.fulfill({ status: 404 }));
  await page.reload();
  await expect(page.getByRole("status")).toContainText("Could not load dist/index.mjs");
  await expect(page.locator("#hint")).toBeHidden();
});

test("the playground has a dark theme, and carries no other company's name", async ({ page }) => {
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const light = await background();
  await page.emulateMedia({ colorScheme: "dark" });
  // The page follows a change of the system as it happens, through a listener.
  await expect.poll(background).not.toBe(light);
  const dark = await background();
  // Dark means dark: each channel under a quarter.
  const channels = (dark.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  expect(channels.every((channel) => channel < 64)).toBe(true);
  const text = `${await page.title()} ${await page.locator("body").innerText()}`;
  expect(text).not.toMatch(/youtube|google|bilibili/i);
});

for (const system of ["light", "dark"] as const) {
  test(`on a ${system} system, the Dark theme button switches the playground, a reload keeps it, and the widget takes it at open`, async ({
    page,
  }) => {
    const other = system === "light" ? "dark" : "light";
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.emulateMedia({ colorScheme: system });
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveText("Widget loaded. Use the feedback button.");
    const button = page.getByRole("button", { name: "Dark theme" });
    await expect(button).toHaveAttribute("aria-pressed", String(system === "dark"));
    expect(await theme()).toBe(system);
    const before = await background();

    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", String(other === "dark"));
    expect(await theme()).toBe(other);
    const after = await background();
    expect(after).not.toBe(before);
    // The widget follows the switch at once, with no open and no reload.
    await expect(page.locator("visual-feedback").locator(".trigger")).toHaveCSS("color", after);
    // The widget reads the page again at open: its panel takes the page's new background.
    await page.getByRole("button", { name: "Send feedback" }).click();
    await expect(page.locator("visual-feedback").locator(".dialog")).toHaveCSS(
      "background-color",
      after,
    );
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.reload();
    await expect(page.getByRole("status")).toHaveText("Widget loaded. Use the feedback button.");
    expect(await theme()).toBe(other);
    await expect(button).toHaveAttribute("aria-pressed", String(other === "dark"));
    await expect(page.locator("visual-feedback").locator(".trigger")).toHaveCSS("color", after);

    // Back to what the system shows: the page follows the system again.
    await button.click();
    expect(await theme()).toBe(system);
    await page.emulateMedia({ colorScheme: other });
    await expect.poll(theme).toBe(other);
  });
}

test("with the reports panel open, the feedback trigger stays visible and clickable", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Reports/ }).click();
  await expect(page.getByRole("complementary", { name: "Reports" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Widget loaded. Use the feedback button.");
  await expect(page.locator("#empty")).toBeVisible();
  const trigger = page.getByRole("button", { name: "Send feedback" });
  const box = await trigger.boundingBox();
  if (!box) throw new Error("no trigger");
  // The topmost element at the trigger's centre is the widget, not the panel.
  const top = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x ?? 0, y ?? 0)?.localName,
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(top).toBe("visual-feedback");
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Send feedback" })).toBeVisible();
});

test("in the playground, every thumbnail rests at 20% colour and a hovered card fades to full colour, in and out alike", async ({
  page,
}) => {
  await page.goto("/");
  const thumbs = page.locator(".video .thumb");
  await expect(thumbs).toHaveCount(12);
  for (let i = 0; i < 12; i++) await expect(thumbs.nth(i)).toHaveCSS("filter", "saturate(0.2)");
  await expect(thumbs.nth(1)).toHaveCSS("transition-property", "filter");
  await expect(thumbs.nth(1)).toHaveCSS("transition-duration", "0.4s");
  await expect(thumbs.nth(1)).toHaveCSS("transition-timing-function", "ease");
  await expect(thumbs.nth(1)).toHaveCSS("transition-delay", "0s");
  for (let i = 0; i < 12; i++) {
    await page.locator(".video").nth(i).hover();
    await expect(thumbs.nth(i)).toHaveCSS("filter", "saturate(1)");
  }
  // The fade in takes as long as the fade out: the hovered style keeps the same transition.
  await expect(thumbs.nth(11)).toHaveCSS("transition-duration", "0.4s");
  await expect(thumbs.nth(11)).toHaveCSS("transition-timing-function", "ease");
  // Only the hovered card: the one left fades back.
  await page.locator(".video").first().hover();
  await expect(thumbs.first()).toHaveCSS("filter", "saturate(1)");
  await expect(thumbs.nth(11)).toHaveCSS("filter", "saturate(0.2)");
});

test("in the playground, the thumbnails change colour at once under reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const thumb = page.locator(".video .thumb").nth(1);
  await expect(thumb).toHaveCSS("filter", "saturate(0.2)");
  await expect(thumb).toHaveCSS("transition-duration", "0s");
  await page.locator(".video").nth(1).hover();
  await expect(thumb).toHaveCSS("transition-duration", "0s");
  // At once: the first read after the hover is already in colour.
  expect(await thumb.evaluate((element) => getComputedStyle(element).filter)).toBe("saturate(1)");
});

test("in the playground on a touch screen, which cannot hover, the thumbnails stay in colour", async ({
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
  await page.goto("/");
  expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);
  const thumbs = page.locator(".video .thumb");
  await expect(thumbs).toHaveCount(12);
  for (let i = 0; i < 12; i++) await expect(thumbs.nth(i)).toHaveCSS("filter", "none");
  await context.close();
});
