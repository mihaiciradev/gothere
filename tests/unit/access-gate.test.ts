import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  gateMode,
  isUngatedPath,
  issueAccessToken,
  passwordMatches,
  verifyAccessToken,
} from "@/infrastructure/access-gate";

const secret = "s".repeat(32);
const password = "correct-horse-battery";

describe("access gate", () => {
  it("is off locally, on with a password, and fails closed in deployed environments without one", () => {
    expect(gateMode({ APP_ENV: "local" })).toBe("off");
    expect(gateMode({ APP_ENV: "test" })).toBe("off");
    expect(gateMode({ APP_ENV: "local", SITE_ACCESS_PASSWORD: password, BETTER_AUTH_SECRET: secret })).toBe("on");
    expect(gateMode({ APP_ENV: "preview" })).toBe("misconfigured");
    expect(gateMode({ APP_ENV: "production", SITE_ACCESS_PASSWORD: "short", BETTER_AUTH_SECRET: secret })).toBe("misconfigured");
    expect(gateMode({ APP_ENV: "preview", SITE_ACCESS: "open" })).toBe("off");
  });

  it("issues tokens that verify until they expire and stop verifying when the password rotates", () => {
    const now = 1_800_000_000;
    const token = issueAccessToken({ secret, password }, now);
    expect(verifyAccessToken(token, { secret, password }, now + 60)).toBe(true);
    expect(verifyAccessToken(token, { secret, password }, now + 8 * 24 * 3600)).toBe(false);
    expect(verifyAccessToken(token, { secret, password: "rotated-password-1" }, now + 60)).toBe(false);
    expect(verifyAccessToken(token, { secret: "t".repeat(32), password }, now + 60)).toBe(false);
  });

  it("rejects tampered, malformed and missing tokens", () => {
    const now = 1_800_000_000;
    const [expires, signature] = issueAccessToken({ secret, password }, now).split(".");
    expect(verifyAccessToken(`${Number(expires) + 9999}.${signature}`, { secret, password }, now)).toBe(false);
    expect(verifyAccessToken(`${expires}.${signature!.slice(0, -1)}x`, { secret, password }, now)).toBe(false);
    for (const bad of [undefined, "", "abc", "123", "x.y.z"]) expect(verifyAccessToken(bad, { secret, password }, now)).toBe(false);
  });

  it("only exempts the gate, the privacy notice and self-authenticating machine endpoints", () => {
    for (const p of ["/access", "/api/access", "/privacy", "/api/payments/simulator/webhook", "/api/operations/run"]) expect(isUngatedPath(p)).toBe(true);
    for (const p of ["/", "/discover", "/api/events", "/api/concierge", "/organizer", "/control", "/accessx", "/api/operations"]) expect(isUngatedPath(p)).toBe(false);
  });

  it("compares passwords exactly", () => {
    expect(passwordMatches(password, password)).toBe(true);
    expect(passwordMatches(`${password} `, password)).toBe(false);
    expect(passwordMatches("", password)).toBe(false);
  });

  it("keeps the CSP strict outside scripts and only upgrades requests over https", () => {
    const csp = contentSecurityPolicy({ dev: false, https: true });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy({ dev: false, https: false })).not.toContain("upgrade-insecure-requests");
  });
});
