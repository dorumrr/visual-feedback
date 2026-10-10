import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.FIXTURE_PORT ?? 4173);

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run --silent build -- --logLevel warn && node tests/serve.mjs",
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
  },
});
