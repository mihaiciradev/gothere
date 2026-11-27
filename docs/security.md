# Security

## Assets

Attendee accounts and sessions · tenant commercial data (sales, demand, pricing) · inventory integrity · payment and order records · approval decisions · audit trail · AI provider credentials and budget.

## Actors and trust boundaries

| Actor | Trust | Notes |
| --- | --- | --- |
| Anonymous visitor | none | Public catalogue only. |
| Attendee | own data | Own reservations, orders, tickets. |
| Organizer member | own tenant, by role | `owner`, `manager`, `analyst` (see `modules/organizations/domain/permissions.ts`). |
| Platform administrator | platform operations | Control Center; **no implicit tenant commercial access**. |
| AI model | untrusted output | Proposes; never authorizes. Acts only through registered actions with the invoking user's permissions. |
| External content | untrusted data | Event descriptions, attendee messages, logs, issues: treated as data in prompts, never as instructions. |
| Payment simulator | semi-trusted | Notifications are deduplicated and verified against our own attempt records. |

Boundaries: browser ↔ Next.js server (session cookie, origin checks); server ↔ PostgreSQL (least-privilege role in deployed environments); server ↔ AI provider (sanitized payloads, server-only key); server ↔ coding agents (sanitized reports only, human approval).

## Controls in place (M0)

| Area | Control |
| --- | --- |
| Authentication | Better Auth email + password, scrypt hashing, min 12 chars; DB-backed sessions (7 days, rolling daily); `HttpOnly`, `SameSite=Lax`, `Secure` in preview/production; cookie prefix `gothere`. |
| CSRF | Better Auth origin validation on state-changing requests (verified: cross-origin POST → 403 `INVALID_ORIGIN`). `trustedOrigins` = `BETTER_AUTH_URL` only. |
| Brute force | DB-backed rate limits (works on serverless): sign-in 5/min, sign-up 3/min, other auth 100/min per IP (verified: 6th attempt → 429). |
| Privilege escalation | `platformRole` cannot be set via sign-up (`input: false`, tested). Roles are changed only server-side. |
| Authorization | Server-side, per call, from the database (`requireOrganizationPermission`). Cross-tenant → `NOT_FOUND`. |
| Tenant isolation (DB) | Composite tenant foreign keys on experiences, inventory, reservations, orders, tickets. |
| Financial safety | `payment_attempts.simulated = true` enforced by a check constraint. |
| Audit | Append-only `audit_records` (trigger-enforced). |
| Input validation | Zod at boundaries (env today; every route/action from M1). |
| Errors | Closed error-code set; internal errors never reach clients. |
| Logging | Structured JSON, recursive redaction of secret-like keys. |
| Secrets | Validated at startup; `.env.local` git-ignored; `.env.example` documents all variables with no values. |
| HTTP headers | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `COOP`; `X-Powered-By` removed. HSTS is set by Vercel. |
| Scripts | Migrations and seeds refuse `APP_ENV=production`; integration tests refuse any DB that is not local and `*_test`. |
| Supply chain | Lockfile committed; install scripts allow-listed (`pnpm-workspace.yaml`); `pnpm audit --prod --audit-level high` in CI. |

## Risk register

| ID | Risk | Severity | Status / mitigation |
| --- | --- | --- | --- |
| R-01 | No email verification: anyone can register any email address | Medium | Accepted for prototype (no email provider). Demo accounts use `.test`. Enable verification before real users. |
| R-02 | No Content-Security-Policy yet | Medium | Planned M5 with nonces once UI and third-party scripts are known. React escaping is the current XSS defence. |
| R-03 | Reservation hoarding by bots | High | M1: per-user active reservation cap, `max_per_order`, short expiry, rate limits. Production: WAF + bot management + waiting room. |
| R-04 | Prompt injection via event content or attendee messages | High | M3: untrusted content delimited as data; tools are registry actions with server-side authorization; HIGH-risk actions need human approval bound to parameters. |
| R-05 | Approval parameter tampering or replay | High | M3: approval stores hash of canonical parameters, single-use, expiry, re-authorization at execution. |
| R-06 | AI cost runaway | Medium | M3: per-request token caps, monthly budget env var, usage records, graceful degradation. |
| R-07 | Better Auth `get-session` returns the session token to same-origin JavaScript | Low | Library behaviour; impact requires XSS (see R-02). Revisit with CSP. |
| R-08 | Rate-limit key is the client IP from `x-forwarded-for` | Low | Correct behind Vercel's proxy; would need `trustedProxies` behind another proxy. |
| R-09 | Moderate advisory GHSA-67mh-4wv8-2f99 in `esbuild ≤ 0.24.2`, pulled via `better-auth → drizzle-kit` peer | Low | Affects esbuild's dev server only, which we do not run. Track upstream. |
| R-10 | Deployed DB role has DDL privileges | Medium | Before public deploy: separate migration role and least-privilege runtime role on Neon. |
| R-11 | Platform admin demo credentials | High if leaked | Admin password only from env; never shown in the public demo; admin login disabled on the public deployment unless the CTO decides otherwise. |

Critical or unmitigated High findings block public deployment.
