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

## Controls in place (M0–M1)

| Area | Control |
| --- | --- |
| Authentication | Better Auth email + password, scrypt hashing, min 12 chars; DB-backed sessions (7 days, rolling daily); `HttpOnly`, `SameSite=Lax`, `Secure` in preview/production; cookie prefix `gothere`. |
| CSRF | Better Auth origin validation on its routes. Our API routes: every cookie-carrying non-GET request must present our Origin (or `Sec-Fetch-Site: same-origin`), else 403 (tested). `SameSite=Lax` cookies. |
| Brute force | DB-backed rate limits (works on serverless): sign-in 5/min, sign-up 3/min, other auth 100/min per IP (verified: 6th attempt → 429). |
| Privilege escalation | `platformRole` cannot be set via sign-up (`input: false`, tested). Roles are changed only server-side. |
| Authorization | Organizer: `requireOrganizationPermission` inside every mutation transaction, tenant taken from the stored row. Attendee: every reservation, payment, order and ticket query is filtered by the session user; foreign ids → `NOT_FOUND` (tested). |
| Tenant and event integrity (DB) | Composite foreign keys chain event, tenant, user and reservation through every relationship (lines, orders, payments, tickets); cross-event and cross-tenant references are rejected by PostgreSQL (tested). |
| Financial safety | Simulated payments only (check constraint, `simulated: true` in responses, labelled simulator ledger). Amounts captured server-side and immutable (trigger). Provider successes recorded before processing; accepted at most once; all others refunded (simulated). |
| Payment notifications | HMAC-SHA256 signature with a 5-minute window, verified in constant time before parsing or storing. A valid notification only affects the attempt it names and still passes the acceptance policy. No unauthenticated endpoint can confirm a payment. |
| Demo controls | Non-default simulator scenarios only when `PAYMENT_SIMULATOR_SCENARIOS=enabled` (default: local/test only), otherwise 403. A scenario only affects the caller's own simulated payment. |
| Hoarding | Max 3 active holds per user (atomic under a per-user advisory lock), `max_per_order` 1–20 (DB-checked), 10-minute holds, DB-backed per-user limits: 20 reservation and 10 payment requests per minute. |
| Job runner | `/api/operations/run` requires `Authorization: Bearer $CRON_SECRET` (constant-time compare); 503 if unset. |
| Audit | Append-only `audit_records` (trigger-enforced); organizer mutations, payment acceptance, refund decisions and simulated refunds are audited in the same transaction. |
| Input validation | Strict Zod schemas on every route body (unknown fields such as prices rejected), 32 KB body limit, `Idempotency-Key` format checked. |
| Errors | Closed error-code set; internal errors never reach clients. |
| Logging | Structured JSON with correlation ids (`x-request-id`, propagated into jobs), recursive redaction of secret-like keys. |
| Secrets | Validated at startup; `.env.local` git-ignored; `.env.example` documents all variables with no values. |
| HTTP headers | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `COOP`; `X-Powered-By` removed. HSTS is set by Vercel. |
| Scripts | Migrations and seeds refuse `APP_ENV=production`; the admin demo account is seeded only for local/test unless `SEED_ALLOW_ADMIN=true`; synthetic seed buyers have no credentials; integration tests refuse any DB that is not local and `*_test`. |
| Database roles | `scripts/sql/database-roles.sql`: migrator (DDL) and app (DML only, no audit mutation, no truncate); validated locally. |
| Supply chain | Lockfile committed; install scripts allow-listed (`pnpm-workspace.yaml`); `pnpm audit --prod --audit-level high` in CI. |
| Attendee UI (M2) | Post-sign-in redirects pass `safeRedirectPath` (same-origin, attendee sections only, no `//`, backslashes or control characters; unit-tested). Selections carried through sign-in (`?select=`) are re-validated server-side against live availability. Malformed ids return 404 before reaching SQL (`assertUuid`). Pages read data through the same owner-checked services as the API; client components never hold prices that matter. QR codes are generated server-side from the ticket code and labelled display-only. Errors show generic copy; details stay in logs. |
| Reconciliation (pre-M2) | Provider success after a failed attempt is accepted or refunded (never ignored); inferred failures are verified with the provider; `findUnreconciledProviderSuccesses` lists anything unaccounted for. Payment Idempotency-Keys are bound to a request hash. |

## Risk register

| ID | Risk | Severity | Status / mitigation |
| --- | --- | --- | --- |
| R-01 | No email verification: anyone can register any email address | Medium | Accepted for prototype (no email provider). Demo accounts use `.test`. Enable verification before real users. |
| R-02 | No Content-Security-Policy yet | Medium | Now that the UI exists the inputs are known: self, Unsplash images, no third-party scripts. Nonce-based CSP planned for M5. React escaping and server-rendered QR (data URI, no innerHTML) are the current defences. |
| R-03 | Reservation hoarding by bots | Medium (was High) | **Mitigated in M1**: atomic per-user cap, `max_per_order`, 10-minute holds, per-user rate limits. Residual: many accounts (no email verification, R-01). Production: WAF, bot management, waiting room, verified accounts. |
| R-04 | Prompt injection via event content or attendee messages | High | M3: untrusted content delimited as data; tools are registry actions with server-side authorization; HIGH-risk actions need human approval bound to parameters. |
| R-05 | Approval parameter tampering or replay | High | M3: approval stores hash of canonical parameters, single-use, expiry, re-authorization at execution. |
| R-06 | AI cost runaway | Medium | M3: per-request token caps, monthly budget env var, usage records, graceful degradation. |
| R-07 | Better Auth `get-session` returns the session token to same-origin JavaScript | Low | Library behaviour; impact requires XSS (see R-02). Revisit with CSP. |
| R-08 | Rate-limit key is the client IP from `x-forwarded-for` | Low | Correct behind Vercel's proxy; would need `trustedProxies` behind another proxy. |
| R-09 | Moderate advisory GHSA-67mh-4wv8-2f99 in `esbuild ≤ 0.24.2`, pulled via `better-auth → drizzle-kit` peer | Low | Affects esbuild's dev server only, which we do not run. Track upstream. |
| R-10 | Deployed DB role has DDL privileges | Medium | **Prepared in M1**: `scripts/sql/database-roles.sql` (validated locally). Must be applied on Neon before public deployment. |
| R-11 | Platform admin demo credentials | High if leaked | **Mitigated in M1**: admin not seeded in preview/production unless `SEED_ALLOW_ADMIN=true`; password only from env; never displayed. |
| R-12 | Double charge after a provider timeout plus an attendee retry | Medium | By design both successes are recorded; one is accepted, the other auto-refunded (simulated) and visible. Production: provider-side idempotency keys. |
| R-13 | A leaked webhook secret would allow forged notifications | Medium | Forgeries still need a matching attempt, an active unexpired reservation and the exact amount to produce tickets. Rotate `PAYMENT_WEBHOOK_SECRET`; real providers add per-endpoint secrets and IP allow-lists. |
| R-14 | Application rate limits are per user, not per IP | Low | Auth endpoints are per IP (Better Auth). Anonymous catalogue reads are unthrottled; CDN caching and WAF in production. |
| R-15 | `after()` maintenance passes add work to attendee requests | Low | Bounded (10 jobs), best-effort; correctness never depends on them. |
| R-16 | A hold released while its payment is pending ends as a refund | Low | **Mitigated in M2**: the checkout offers release only when no payment is in flight. The API still allows it; outcome stays deterministic. |
| R-17 | Imagery is hotlinked from Unsplash | Low | Availability and privacy (Unsplash sees image requests). Production: copy approved images to our own storage/CDN. Required `img-src` entry for the future CSP. |
| R-18 | Simulator demo controls are visible in checkout when enabled | Low | Only where `PAYMENT_SIMULATOR_SCENARIOS=enabled` (default off outside local/test); they affect only the caller's own simulated payment. Keep disabled on any public demo. |
| R-19 | The opportunistic maintenance throttle is per server instance (in memory) | Low | Optimisation only, never a source of truth; correctness uses the database clock. Prevents polling stampedes that saturated a 5-connection pool under 12 parallel browsers. |

Critical or unmitigated High findings block public deployment.
