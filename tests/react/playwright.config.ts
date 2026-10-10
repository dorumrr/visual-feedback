import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.FIXTURE_PORT ?? 4175);

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  use: { baseURL: `http://127.0.0.1:${port}` },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "npm run --silent build -- --logLevel warn && node tests/react/serve-next.mjs",
    cwd: "../..",
    url: `http://127.0.0.1:${port}/`,
    env: { FIXTURE_PORT: String(port) },
    timeout: 180_000,
    reuseExistingServer: false,
    // A kill gives the script no time to stop Next.js and remove its temporary copy.
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
});
