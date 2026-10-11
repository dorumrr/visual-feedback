import { expect, test } from "@playwright/test";

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
    await expect(page.locator("visual-feedback").locator(".trigger")).toHaveCSS(
      "background-color",
      after,
    );
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
    await expect(page.locator("visual-feedback").locator(".trigger")).toHaveCSS(
      "background-color",
      after,
    );

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
