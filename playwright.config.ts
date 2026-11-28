import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;

// A second server with the pre-release access gate on (tests/e2e/access-gate.spec.ts). The password is a throwaway
// test value generated per run; specs read it from the environment and it never leaves this machine.
const gatedPort = port + 1;
const gatedURL = `http://localhost:${gatedPort}`;
process.env.E2E_GATED_URL = gatedURL;
process.env.E2E_GATE_PASSWORD ??= `gate-${randomUUID()}`;

// AI is always off in end-to-end runs (empty = unset, overriding .env.local): tests never spend provider
// credits and never depend on model latency. AI paths are covered by integration tests with a scripted provider.
const aiOff = { ANTHROPIC_API_KEY: "", AI_MODEL_FAST: "", AI_MONTHLY_BUDGET_MINOR: "" };

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
  webServer: [
    {
      command: `pnpm start -p ${port}`,
      url: `${baseURL}/api/auth/ok`,
      reuseExistingServer: !process.env.CI,
      // The auth origin must match the port the test server listens on.
      // Test mode: no auth rate limiting across parallel journeys; simulator scenarios enabled; gate off.
      env: {
        BETTER_AUTH_URL: baseURL,
        APP_ENV: "test",
        PAYMENT_SIMULATOR_SCENARIOS: "enabled",
        DATABASE_POOL_MAX: "10",
        SITE_ACCESS_PASSWORD: "",
        ...aiOff,
      },
      timeout: 120_000,
    },
    {
      command: `pnpm start -p ${gatedPort}`,
      url: `${gatedURL}/privacy`,
      reuseExistingServer: !process.env.CI,
      env: {
        BETTER_AUTH_URL: gatedURL,
        APP_ENV: "test",
        DATABASE_POOL_MAX: "4",
        SITE_ACCESS_PASSWORD: process.env.E2E_GATE_PASSWORD,
        ...aiOff,
      },
      timeout: 120_000,
    },
  ],
});
