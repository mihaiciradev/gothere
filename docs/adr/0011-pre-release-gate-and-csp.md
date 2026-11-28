# ADR-0011: Pre-release access gate, Content Security Policy and AI spending rule

Status: Accepted · 2026-11-28

## Context
The Git-connected Vercel project serves `main` publicly at https://gothere.mihaic.me before release verification
(M5). The CTO asked for a temporary password gate, a CSP, a privacy notice, and a guarantee that unauthorized visitors
cannot trigger AI spending, while payment webhooks and cron keep working. No paid infrastructure (Vercel's
password protection for production is a paid feature).

## Decision
- **Gate in `src/proxy.ts`** (Next 16 proxy, Node runtime). Every page and API route needs an HttpOnly, SameSite=Lax,
  Secure-on-https cookie `gt_access` = `expiry.HMAC(BETTER_AUTH_SECRET, expiry + password fingerprint)`, valid 7 days;
  rotating `SITE_ACCESS_PASSWORD` invalidates all cookies. Pages redirect (303) to `/access?next=…`; APIs answer 401.
  The password form posts to `/api/access` (same-origin check, 10 attempts / 10 min per IP, constant-time compare,
  `safeRedirectPath` for `next`). Ungated: `/access`, `/api/access`, `/privacy`, and machine endpoints that
  authenticate themselves (`/api/payments/simulator/webhook` HMAC, `/api/operations/run` bearer `CRON_SECRET`).
- **Fail closed:** with `APP_ENV` preview/production and no password, the site is closed (machine endpoints still
  work). `SITE_ACCESS=open` removes the gate explicitly. Locally and in tests it is off unless a password is set.
- **CSP** (all routes, `next.config.ts`): `default-src 'self'`; `script-src 'self' 'unsafe-inline'`; `style-src 'self'
  'unsafe-inline'`; `img-src 'self' data: blob: https://images.unsplash.com`; `connect-src 'self'`; `object-src 'none'`;
  `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`; `upgrade-insecure-requests` over https.
  Nonce-based CSP was rejected for now: Next requires fully dynamic rendering for nonces and documents it as
  incompatible with Partial Prerendering, which every page uses. Inline scripts remain allowed; third-party scripts,
  foreign connections, framing, plugins and foreign form targets are blocked.
- **AI spending rule:** the concierge uses the model only for signed-in visitors; anonymous visitors get the plain
  search. Organiser AI already requires an organization membership. Combined with the gate, an outsider cannot reach
  any code path that calls the provider; the monthly budget (ADR-0008) bounds everyone else.
- **Privacy notice** at `/privacy` (ungated), linked from the footer, the sign-up form and the concierge.

## Consequences
+ No paid features; works with PPR; machine traffic unaffected (tested in e2e against a gated server).
+ The gate is defence in depth, not authorization: every route still enforces its own auth.
− `'unsafe-inline'` scripts: an injected inline script would still run. React escaping remains the primary XSS
  defence. Revisit with SRI/hashes or nonces if pages move to dynamic rendering.
− A shared password; anyone who has it can sign up. Remove the gate (`SITE_ACCESS=open`) only after M5 verification.
