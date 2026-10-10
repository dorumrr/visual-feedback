import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.FIXTURE_PORT ?? 4177);

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  // One app and one report folder: the browsers send one after another.
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "node tests/pack-smoke/serve.mjs",
    cwd: "../..",
    url: `http://127.0.0.1:${port}/`,
    env: { FIXTURE_PORT: String(port) },
    timeout: 300_000,
    reuseExistingServer: false,
    // A kill gives the script no time to stop Next.js and remove its temporary app.
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
