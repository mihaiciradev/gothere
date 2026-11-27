import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://gothere:gothere_local@127.0.0.1:54329/gothere_test";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/support/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: {
            APP_ENV: "test",
            DATABASE_URL: testDatabaseUrl,
            BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0000",
            BETTER_AUTH_URL: "http://localhost:3000",
            CRON_SECRET: "test-cron-secret-test-cron-secret-000000",
            PAYMENT_WEBHOOK_SECRET: "test-webhook-secret-test-webhook-secret-0",
            PAYMENT_SIMULATOR_SCENARIOS: "enabled",
            LOG_LEVEL: "error",
          },
        },
      },
    ],
  },
});
