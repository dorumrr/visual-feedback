// Makes docs/demo.png, the README's picture, from tests/fixtures/demo/: a made-up page, so no real
// data is in it. Run it with `npm run demo` after `npm run build`.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const port = process.env.FIXTURE_PORT ?? "4176";
// Refuse a busy port before starting, so the picture can only be of this repo's demo page.
await new Promise((resolve, reject) => {
  const probe = createServer().once("error", () => reject(new Error(`port ${port} is in use`)));
  probe.listen(Number(port), "127.0.0.1", () => probe.close(resolve));
});
const server = spawn(process.execPath, [fileURLToPath(new URL("serve.mjs", import.meta.url))], {
  env: { ...process.env, FIXTURE_PORT: port },
  stdio: "inherit",
});
// A server that stops early, such as on a port already in use, must not leave a picture of
// whatever else answers there.
let stopped = false;
server.on("exit", () => {
  stopped = true;
});
let browser;
try {
  browser = await chromium.launch();
  const viewport = { width: 1280, height: 800 };
  const page = await browser.newPage({ viewport });
  for (let tries = 0; ; tries++) {
    try {
      if (stopped) throw new Error(`the test server stopped; is port ${port} in use?`);
      await page.goto(`http://127.0.0.1:${port}/demo/`);
      break;
    } catch (error) {
      if (tries > 50) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  const cell = await page.getByText("$NaN").boundingBox();
  if (!cell) throw new Error("no $NaN cell on the page");
  await page.getByRole("button", { name: "Send feedback" }).click();
  const image = page.locator("visual-feedback").locator(".image");
  await image.waitFor();
  const box = await image.boundingBox();
  if (!box) throw new Error("no screenshot in the dialog");
  // A point of the page, where the dialog shows it in the screenshot.
  const at = (x, y) => [
    box.x + (x * box.width) / viewport.width,
    box.y + (y * box.height) / viewport.height,
  ];
  const pad = 10;
  await page.getByRole("button", { name: "Box" }).click();
  await page.mouse.move(...at(cell.x - pad, cell.y - pad));
  await page.mouse.down();
  await page.mouse.move(...at(cell.x + cell.width + pad, cell.y + cell.height + pad), { steps: 8 });
  await page.mouse.up();
  await page.getByRole("button", { name: "Arrow" }).click();
  await page.mouse.move(...at(cell.x - 260, cell.y + 170));
  await page.mouse.down();
  await page.mouse.move(...at(cell.x - pad - 4, cell.y + cell.height / 2), { steps: 8 });
  await page.mouse.up();
  await page.getByLabel("Your note").fill("The total for #1043 shows $NaN.");
  await page.screenshot({ path: fileURLToPath(new URL("../docs/demo.png", import.meta.url)) });
} finally {
  await browser?.close();
  server.kill();
}
