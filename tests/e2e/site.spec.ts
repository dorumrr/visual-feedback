import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { expect, test } from "@playwright/test";

// GitHub Pages serves a project site under its repo's name, never at the root.
const BASE = "https://pages.test/visual-feedback/";
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
};

let folder: string;
let site: string;
test.beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), "vf-site-"));
  site = join(folder, "site");
  execFileSync(process.execPath, ["tests/site.mjs", site]);
});
test.afterAll(() => rmSync(folder, { recursive: true, force: true }));

test("the demo site works from a subpath and loads nothing from the site's root", async ({
  page,
}) => {
  // Every request the build cannot answer: another origin, outside the subpath, or a file it left out.
  const missing: string[] = [];
  await page.route("https://pages.test/**", (route) => {
    const { pathname } = new URL(route.request().url());
    const path = pathname.startsWith("/visual-feedback/")
      ? pathname.slice("/visual-feedback/".length) || "index.html"
      : undefined;
    try {
      if (path === undefined) throw new Error("outside");
      return route.fulfill({
        body: readFileSync(join(site, path)),
        contentType: TYPES[extname(path)] ?? "application/octet-stream",
      });
    } catch {
      missing.push(pathname);
      return route.fulfill({ status: 404 });
    }
  });
  page.on("request", (request) => {
    const url = request.url();
    if (!/^(https:\/\/pages\.test\/|blob:|data:)/.test(url)) missing.push(url);
  });
  await page.goto(BASE);
  await expect(page.getByRole("status")).toHaveText("Widget loaded. Use the feedback button.");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await page.getByRole("textbox", { name: "Your note" }).fill("From the demo site");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const report = page.locator(".report");
  await expect(report.getByRole("heading", { name: "From the demo site" })).toBeVisible();
  await expect(report.getByRole("img", { name: "Screenshot 1" })).toBeVisible();
  expect(missing).toEqual([]);
  // The same snapdom copy as the tests and the playground: with the line-clamp fix.
  expect(readFileSync(join(site, "vendor/snapdom.mjs"), "utf8")).toContain("t.scrollHeight<=c+n");
});
