import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Temporary site-wide access gate (pre-release). Server-side only: the proxy checks a signed, HttpOnly cookie on every
 * request. The cookie carries an expiry and an HMAC over (expiry, password fingerprint), so rotating the password
 * invalidates every issued cookie. Machine endpoints authenticate themselves and are never gated.
 */

export const ACCESS_COOKIE = "gt_access";
export const ACCESS_TTL_SECONDS = 7 * 24 * 3600;

/** Paths reachable without the gate: the gate itself, the privacy notice, and self-authenticating machine endpoints. */
export const UNGATED_PATHS = [
  "/access",
  "/api/access",
  "/privacy",
  "/api/payments/simulator/webhook", // HMAC-signed provider notifications
  "/api/operations/run", // Vercel Cron / manual runs, bearer CRON_SECRET
] as const;

export type GateMode = "off" | "on" | "misconfigured";

type GateEnv = Readonly<Record<string, string | undefined>>;

/**
 * `on` when a password is configured. Deployed environments (preview, production) fail closed: without a password
 * they are `misconfigured` (everything gated except machine endpoints) unless explicitly opened with SITE_ACCESS=open.
 */
export function gateMode(env: GateEnv): GateMode {
  if (env.SITE_ACCESS === "open") return "off";
  const password = env.SITE_ACCESS_PASSWORD ?? "";
  if (password.length >= 12 && (env.BETTER_AUTH_SECRET ?? "").length >= 32) return "on";
  if (env.APP_ENV === "preview" || env.APP_ENV === "production") return "misconfigured";
  return "off";
}

export function isUngatedPath(pathname: string): boolean {
  return UNGATED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const fingerprint = (password: string) => createHash("sha256").update(`site-access:${password}`).digest("hex").slice(0, 16);
const sign = (secret: string, payload: string) => createHmac("sha256", `site-access:${secret}`).update(payload).digest("base64url");

export function issueAccessToken(env: { secret: string; password: string }, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const expires = nowSeconds + ACCESS_TTL_SECONDS;
  return `${expires}.${sign(env.secret, `${expires}.${fingerprint(env.password)}`)}`;
}

export function verifyAccessToken(token: string | undefined, env: { secret: string; password: string }, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!token) return false;
  const [expiresRaw, signature] = token.split(".");
  const expires = Number(expiresRaw);
  if (!signature || !Number.isInteger(expires) || expires <= nowSeconds) return false;
  const expected = Buffer.from(sign(env.secret, `${expires}.${fingerprint(env.password)}`));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Constant-time password comparison (digests have equal length regardless of input). */
export function passwordMatches(candidate: string, password: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(password).digest();
  return timingSafeEqual(a, b);
}

/** Content Security Policy. Inline scripts are allowed because Partial Prerendering (static shells streamed with
 * request-time holes) cannot carry per-request nonces; everything else is locked to our origin (ADR-0011). */
export function contentSecurityPolicy(options: { dev: boolean; https: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${options.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://images.unsplash.com",
    "font-src 'self'",
    `connect-src 'self'${options.dev ? " ws: wss:" : ""}`,
    "media-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(options.https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
