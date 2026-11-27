import { describe, expect, it } from "vitest";
import { EnvValidationError, parseServerEnv } from "@/infrastructure/env";

const valid = {
  DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  PAYMENT_WEBHOOK_SECRET: "w".repeat(32),
};

describe("server environment", () => {
  it("parses a valid environment with defaults", () => {
    const env = parseServerEnv(valid);
    expect(env.APP_ENV).toBe("local");
    expect(env.DATABASE_POOL_MAX).toBe(5);
  });

  it("reports every invalid variable", () => {
    try {
      parseServerEnv({ BETTER_AUTH_SECRET: "short" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const issues = (error as EnvValidationError).issues.join("\n");
      expect(issues).toContain("DATABASE_URL");
      expect(issues).toContain("BETTER_AUTH_SECRET");
      expect(issues).toContain("BETTER_AUTH_URL");
    }
  });

  it("treats empty optional variables (KEY= copied from .env.example) as unset", () => {
    const empty = Object.fromEntries(
      ["CRON_SECRET", "PAYMENT_SIMULATOR_SCENARIOS", "ANTHROPIC_API_KEY", "AI_MODEL_FAST", "AI_MONTHLY_BUDGET_MINOR", "AI_INPUT_MICRO_USD_PER_MTOK", "AI_OUTPUT_MICRO_USD_PER_MTOK", "AI_TIMEOUT_MS"].map((k) => [k, ""]),
    );
    const env = parseServerEnv({ ...valid, ...empty });
    expect(env.CRON_SECRET).toBeUndefined();
    expect(env.PAYMENT_SIMULATOR_SCENARIOS).toBeUndefined();
    expect(env.AI_MODEL_FAST).toBeUndefined();
    expect(env.AI_TIMEOUT_MS).toBe(12_000);
  });

  it("requires https for the auth URL in production", () => {
    expect(() => parseServerEnv({ ...valid, APP_ENV: "production" })).toThrow(/https/);
    expect(parseServerEnv({ ...valid, APP_ENV: "production", BETTER_AUTH_URL: "https://gothere.ro" }).APP_ENV).toBe(
      "production",
    );
  });
});
