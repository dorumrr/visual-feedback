import { expect, test } from "@playwright/test";
import { markdown } from "../recipes/doc";

const { block, cleanup } = markdown("README.md");
test.afterAll(cleanup);

test("the README's browser example, as written, adds the button and posts to its endpoint", async ({
  page,
}) => {
  const posted: string[] = [];
  await page.route("**/api/feedback", async (route) => {
    posted.push(route.request().headers()["content-type"] ?? "");
    await route.fulfill({ status: 204 });
  });
  await page.goto("/widget/");
  const source = block("js");
  expect(source).toContain('from "visual-feedback"');
  // A page has no bundler, so the package name points at the built file the package exports.
  await page.addScriptTag({
    type: "module",
    content: source.replace('"visual-feedback"', '"/dist/index.mjs"'),
  });
  await page.getByRole("button", { name: "Send feedback" }).click();
  await page.getByLabel("Your note").fill("From the README example");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Thanks, it's sent.");
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatch(/^multipart\/form-data; boundary=/);
});
