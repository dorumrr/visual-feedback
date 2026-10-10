import { expect, test } from "@playwright/test";
import { isAccurate, measureCapture } from "./accuracy";

const SPEC_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:";

async function captureUnder(page: import("@playwright/test").Page, policy: string) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { violations: string[] }).violations = seen;
    document.addEventListener("securitypolicyviolation", (e) => seen.push(e.effectiveDirective));
  });
  await page.route("**/capture/csp.html", async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /<meta http-equiv="Content-Security-Policy"[^>]*>/,
      "",
    );
    await route.fulfill({
      response,
      body,
      headers: { ...response.headers(), "content-security-policy": policy },
    });
  });
  await page.goto("/capture/csp.html");
  await page.evaluate(() => document.fonts.ready);
  // WebKit screenshots inject an inline style, which the policy would report, so the reference
  // comes from the same fixture opened without the policy.
  const reference = await page.context().newPage();
  await reference.goto("/capture/csp.html");
  await reference.evaluate(() => document.fonts.ready);
  const measurement = await measureCapture(page, "snapdom", reference);
  // securitypolicyviolation events are dispatched after the blocked load, not during it.
  await page.waitForTimeout(250);
  const violations = await page.evaluate(
    () => (window as unknown as { violations: string[] }).violations,
  );
  return { measurement, violations };
}

test("under the CSP that SPEC section 11 lists, the page loads and captures accurately", async ({
  page,
}) => {
  const { measurement, violations } = await captureUnder(page, SPEC_POLICY);
  expect(violations).toEqual([]);
  expect(isAccurate(measurement), JSON.stringify(measurement)).toBe(true);
});

test("without img-src data: the same capture is blocked, so the check above can fail", async ({
  page,
}) => {
  const { measurement, violations } = await captureUnder(
    page,
    "default-src 'self'; script-src 'self'; style-src 'self'",
  );
  expect(violations).toContain("img-src");
  expect(isAccurate(measurement)).toBe(false);
});
