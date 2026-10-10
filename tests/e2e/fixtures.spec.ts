import { expect, test } from "@playwright/test";

test("the fixture server serves the playground as its own page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/visual-feedback playground/);
});

test("the fixture server serves only its folder and the one vendor file", async ({ request }) => {
  expect((await request.get("/vendor/snapdom.js")).status()).toBe(200);
  expect((await request.get("/vendor/other.js")).status()).toBe(404);
  expect((await request.get("/%2e%2e/%2e%2e/package.json")).status()).toBe(404);
  expect((await request.get("/..%2f..%2fpackage.json")).status()).toBe(403);
  expect((await request.get("/%")).status()).toBe(404);
  expect((await request.get("/dist/index.mjs")).status()).toBe(200);
  expect((await request.get("/dist/..%2fpackage.json")).status()).toBe(403);
  expect((await request.get("/dist/%2e%2e/package.json")).status()).toBe(404);
});
