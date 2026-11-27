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

  it("requires https for the auth URL in production", () => {
    expect(() => parseServerEnv({ ...valid, APP_ENV: "production" })).toThrow(/https/);
    expect(parseServerEnv({ ...valid, APP_ENV: "production", BETTER_AUTH_URL: "https://gothere.ro" }).APP_ENV).toBe(
      "production",
    );
  });
});
