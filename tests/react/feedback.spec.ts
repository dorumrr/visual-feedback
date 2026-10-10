import { expect, type Page, test } from "@playwright/test";

// Page errors and console errors, hydration mismatches included.
function errors(page: Page): string[] {
  const seen: string[] = [];
  page.on("pageerror", (error) => seen.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") seen.push(message.text());
  });
  return seen;
}

// Whether the widget's shortcut takes a keydown on window right now.
const shortcutTaken = (page: Page) =>
  page.evaluate(() => {
    const event = new KeyboardEvent("keydown", {
      key: "F",
      code: "KeyF",
      altKey: true,
      shiftKey: true,
      cancelable: true,
    });
    dispatchEvent(event);
    return event.defaultPrevented;
  });

const trigger = (page: Page, name = "Send feedback") =>
  page.getByRole("button", { name, exact: true });

test("the server renders the page without the widget, which the client then adds once", async ({
  page,
}) => {
  const response = await page.request.get("/");
  expect(response.status()).toBe(200);
  const html = await response.text();
  // The heading as markup, not only as text in the data the client receives.
  expect(html).toContain("<h1>Next.js fixture</h1>");
  expect(html).not.toContain("<visual-feedback");
  const seen = errors(page);
  await page.goto("/");
  await expect(trigger(page)).toBeVisible();
  await expect(page.locator("visual-feedback")).toHaveCount(1);
  expect(seen).toEqual([]);
});

test("it opens on the client and sends to the app's own route", async ({ page }) => {
  const seen = errors(page);
  const note = `From ${test.info().project.name} ${crypto.randomUUID()}`;
  await page.goto("/");
  await trigger(page).click();
  await expect(page.getByRole("dialog", { name: "Send feedback" })).toBeVisible();
  await page.getByLabel("Your note").fill(note);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Thanks, it's sent.");
  const received = (await (await page.request.get("/api/feedback")).json()) as string[];
  expect(received).toContain(note);
  expect(seen).toEqual([]);
});

test("props follow the component, a removed prop goes back to its default, unmount removes it", async ({
  page,
}) => {
  const seen = errors(page);
  await page.goto("/client");
  await expect(trigger(page)).toBeVisible();
  await page.getByRole("button", { name: "Toggle side" }).click();
  const left = await trigger(page, "Left feedback").boundingBox();
  expect(Math.round(left?.x ?? -1)).toBe(16);
  // The left side passes no shortcut: removed, it no longer takes the key.
  expect(await shortcutTaken(page)).toBe(false);
  await page.getByRole("button", { name: "Toggle side" }).click();
  const right = await trigger(page).boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(Math.round(width - (right?.x ?? 0) - (right?.width ?? 0))).toBe(16);
  await expect(page.locator("visual-feedback")).toHaveCount(1);
  // The control: mounted with the shortcut, the same key is taken (and opens it).
  expect(await shortcutTaken(page)).toBe(true);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle widget" }).click();
  await expect(page.locator("visual-feedback")).toHaveCount(0);
  // Unmounted: the shortcut is gone with it.
  expect(await shortcutTaken(page)).toBe(false);
  await page.getByRole("button", { name: "Toggle widget" }).click();
  await expect(page.locator("visual-feedback")).toHaveCount(1);
  await expect(trigger(page)).toBeVisible();
  expect(seen).toEqual([]);
});

test("a prop change goes to update(): an open dialog and its note stay", async ({ page }) => {
  const seen = errors(page);
  await page.goto("/client");
  await page.keyboard.press("Alt+Shift+KeyF");
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await expect(dialog).toBeVisible();
  await page.getByLabel("Your note").fill("Kept");
  await page.evaluate(() => (window as unknown as { setLeft(on: boolean): void }).setLeft(true));
  // A draft hides the trigger, so it is found by class: the prop change still renamed it.
  await expect(page.locator("visual-feedback").locator(".trigger")).toHaveAttribute(
    "aria-label",
    "Left feedback",
  );
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Your note")).toHaveValue("Kept");
  await expect(page.locator("visual-feedback")).toHaveCount(1);
  // The onSubmit given after the change, a new closure, is the one that sends.
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Thanks, it's sent.");
  expect(await page.evaluate(() => (window as unknown as { sent: string[] }).sent)).toEqual([
    "left Kept",
  ]);
  expect(seen).toEqual([]);
});

test("unmounting while the dialog is open removes it and gives the page its scroll back", async ({
  page,
}) => {
  const seen = errors(page);
  await page.goto("/client");
  await trigger(page).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("hidden");
  await page.evaluate(() =>
    (window as unknown as { setMounted(on: boolean): void }).setMounted(false),
  );
  await expect(page.locator("visual-feedback")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.getAttribute("style"))).toBeNull();
  expect(await shortcutTaken(page)).toBe(false);
  expect(seen).toEqual([]);
});

test("the README's React example, as its root layout, renders and sends", async ({ page }) => {
  const seen = errors(page);
  const note = `README ${test.info().project.name} ${crypto.randomUUID()}`;
  await page.goto("/readme");
  await expect(page.getByRole("heading", { name: "README example" })).toBeVisible();
  await expect(page.locator("visual-feedback")).toHaveCount(1);
  await trigger(page).click();
  await page.getByLabel("Your note").fill(note);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Thanks, it's sent.");
  const received = (await (await page.request.get("/api/feedback")).json()) as string[];
  expect(received).toContain(note);
  expect(seen).toEqual([]);
});
