import { expect, test } from "@playwright/test";

test("the playground loads the built package and shows a report", async ({ page }) => {
  await page.goto("/playground/");
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
});

test("in the playground, the trigger captures the page and Send shows the report", async ({
  page,
}) => {
  await page.goto("/playground/");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await page.getByRole("textbox", { name: "Your note" }).fill("From the playground");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const report = page.locator(".report");
  await expect(report.getByRole("heading", { name: "From the playground" })).toBeVisible();
  await expect(report.getByRole("img", { name: "Screenshot 1" })).toBeVisible();
  await expect(report.locator("pre")).toContainText('"marks": []');
});
