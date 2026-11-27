import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  // One local server process shares a single connection pool; keep parallelism realistic.
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm start -p ${port}`,
    url: `${baseURL}/api/auth/ok`,
    reuseExistingServer: !process.env.CI,
    // The auth origin must match the port the test server listens on.
    // Test mode: no auth rate limiting across parallel journeys; simulator scenarios enabled.
    env: { BETTER_AUTH_URL: baseURL, APP_ENV: "test", PAYMENT_SIMULATOR_SCENARIOS: "enabled", DATABASE_POOL_MAX: "10" },
    timeout: 120_000,
  },
});
