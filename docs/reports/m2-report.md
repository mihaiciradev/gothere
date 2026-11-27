# M2 implementation report — Attendee experience

| | |
| --- | --- |
| Milestone | M2 — Attendee experience |
| Status | Complete. **Awaiting independent review.** M3 not started. |
| Baseline | `c8bb69b` (M1) · pre-M2 fix `28bafd9` |
| Report date | 2026-11-27 |

Related: [architecture.md § Attendee interface](../architecture.md#attendee-interface-m2), [assets.md](../assets.md),
[security.md](../security.md), [state-machines.md](../state-machines.md), screenshots in [`m2/`](m2/).

---

## 1. Pre-M2 verification

| Question from review | Finding | Fix | Evidence |
| --- | --- | --- | --- |
| Can a genuine provider success after a failed attempt disappear from reconciliation? | **Yes (bug).** `failed` was terminal, so a later success was processed as `ignored_stale`: money taken, no order, no refund. Reconciliation also skipped failed attempts, so a success hidden behind a locally inferred failure (503) was never found. | `failed → succeeded` allowed (domain + trigger); success is accepted if the reservation is still payable, otherwise `refund_required` → simulated refund. Inferred failures (`provider_unavailable`, `not_received_by_provider`) enqueue a provider verification job. `findUnreconciledProviderSuccesses` reports any provider success not ending accepted/refund_required/refunded (orphans, reference mismatches, unprocessed events). | `payment-reconciliation.test.ts`: 5 of 7 tests failed before the fix, all pass after. Migration `0004`. ADR-0006 amended. |
| Are payment idempotency keys bound to request parameters? | **No (gap).** Replay matched on `(reservation, key)` only. | `payment_attempts.request_hash` (sha256 of reservation + scenario), immutable via trigger; reuse with different parameters → 409 `idempotency_key_reused`. | `payment-reconciliation › payment idempotency` |

CI on `28bafd9` was triggered on push.

## 2. Implemented pages and functionality

| Route | What it does |
| --- | --- |
| `/` | Cinematic featured event (chosen from data: richest upcoming programme), live availability tag, mono ticker of all upcoming events, editorial event index with cursor-following photo preview, experiences rail, category list with live counts, concierge entry (keyword search, labelled as not yet live). |
| `/discover` | Real catalogue search (title, summary, city, venue, experience titles), category/city/month filters as links built from live facets, result count, empty and invalid-filter states, concierge note. |
| `/events/[slug]` | Full-bleed hero, dates/doors/venue/availability, about, programme grouped by day in the event's time zone with imagery, venue block. Ticket panel: passes and experiences, steppers bounded by `max_per_order` and live availability, low-stock and sold-out states (sold-out slot reserved for M3 demand capture), "prices are final · no booking fee", reservation via API, mobile sticky reserve bar. |
| `/sign-in`, `/sign-up` | Better Auth email/password, field validation, mapped server errors (wrong credentials, existing account, rate limit), safe `next` redirect, selection carried through sign-in (`?select=`, re-validated server-side). Signed-in users are redirected away. |
| `/checkout/[id]` | Owner-only server load (lazy expiry first). Order summary with server-calculated prices, countdown from `secondsRemaining` (DB clock), clearly labelled simulated payment, Pay as primary action, simulator outcome as a collapsed demo control (only where enabled), processing / waiting-for-confirmation / declined-and-retry / confirmed / expired / released states, refund notices for late or duplicate successes, release hold. Safe to refresh during a pending payment; polling also advances due background work. |
| `/tickets` | Wallet grouped by event, ticket code, status. Empty state. |
| `/tickets/[id]` | Ticket pass: event image, ticket, dates or session, place, holder, status, server-rendered QR (SVG data URI) and code, "display only — no entry validation" notice, living-ticket placeholder. |
| 404 / error | Designed not-found (also returned for other users' tickets and checkouts) and error boundary. |

Supporting changes:

- **Content model** (`0005`): `events.category`, `hero_image_credit`, `experiences.image_url/image_credit`, https check on hero URLs. Seed refreshes presentation fields only and adds three events (6 total, two organisers, 7 experiences); the 240 seeded orders and the sold-out Sunset Sessions are untouched.
- **Catalogue read models** (`events` module): validated filters (strict Zod, LIKE wildcards escaped), facets, upcoming experiences, availability status (`available` / `limited` ≤ 10% / `sold_out`), overdue holds treated as available.
- **API**: `GET /api/events` accepts the same filters; `secondsRemaining` added to reservation views.
- **Robustness found while building**: hidden-`Activity` routes kept stale in-flight state (fixed with effect cleanups and a keyed panel); `usePathname` blocked prerendering of dynamic routes (isolated behind Suspense); malformed ids caused 500s (now 404 via `assertUuid`); every pending-checkout poll triggered a full maintenance pass (now throttled per instance).

## 3. Screenshots (actual production build)

Captured by `CAPTURE=1 pnpm exec playwright test capture` against `next start` and the seeded database. Desktop is 1280×720
(Desktop Chrome), mobile is 412×915 (Pixel 7).

| | Desktop | Mobile |
| --- | --- | --- |
| Home | ![](m2/desktop-home.jpg) | ![](m2/mobile-home.jpg) |
| Discover | ![](m2/desktop-discover.jpg) | ![](m2/mobile-discover.jpg) |
| Event | ![](m2/desktop-event.jpg) | ![](m2/mobile-event.jpg) |
| Event · tickets | ![](m2/desktop-event-tickets.jpg) | ![](m2/mobile-event-tickets.jpg) |
| Sign-up | ![](m2/desktop-sign-up.jpg) | ![](m2/mobile-sign-up.jpg) |
| Checkout | ![](m2/desktop-checkout.jpg) | ![](m2/mobile-checkout.jpg) |
| Checkout · declined | ![](m2/desktop-checkout-declined.jpg) | ![](m2/mobile-checkout-declined.jpg) |
| Checkout · confirmed | ![](m2/desktop-checkout-confirmed.jpg) | ![](m2/mobile-checkout-confirmed.jpg) |
| Checkout · expired | ![](m2/desktop-checkout-expired.jpg) | ![](m2/mobile-checkout-expired.jpg) |
| Wallet | ![](m2/desktop-tickets.jpg) | ![](m2/mobile-tickets.jpg) |
| Ticket pass | ![](m2/desktop-ticket.jpg) | ![](m2/mobile-ticket.jpg) |

Full-page homepage: [desktop](m2/desktop-home-full.jpg) · [mobile](m2/mobile-home-full.jpg).

Visual review was done on rendered pages at 800, 1024 and 1280 px in the browser pane and on the captures above, and changed
the design: checkout originally placed Pay below seven demo scenario cards (below the fold on both sizes), so Pay now
follows the simulated-payment notice and the simulator became a collapsed disclosure; credits were moved off titles;
contrast failures were corrected (§6).

## 4. Dependencies introduced

| Package | Version | Kind | Why |
| --- | --- | --- | --- |
| `motion` | 14.14.0 | runtime | Reveal, parallax, hover preview, state transitions; reduced-motion aware |
| `qrcode` | 1.5.4 | runtime (server only) | Ticket QR as SVG on the server; no client code |
| `@types/qrcode` | 1.5.6 | dev | Types |
| `@axe-core/playwright` | 4.14.1 | dev | Automated WCAG checks in e2e |

Not added: GSAP (Motion covers the sequences; one animation runtime only), Radix (no component needed native elements
couldn't provide), Recharts (no charts in M2). `pnpm audit --prod`: unchanged — 1 moderate (R-09), 0 high/critical.

## 5. Performance observations

`METRICS=1 pnpm exec playwright test metrics --workers=1`, production build, local machine, local PostgreSQL, no CDN —
indicative only:

| Page | Desktop LCP | Mobile LCP | CLS | JS (KB, compressed) | Images (KB) desktop / mobile |
| --- | --- | --- | --- | --- | --- |
| `/` | 796 ms | 316 ms | 0.002 / 0 | 216 / 210 | 321 / 354 |
| `/discover` | 248 ms | 164 ms | 0 | 210 / 203 | 295 / 749 |
| `/events/halcyon-shore-2027` | 272 ms | 256 ms | 0 | 216 / 210 | 210 / 155 |
| `/sign-in` | 252 ms | 196 ms | 0 | 205 / 205 | 22 / 22 |

- All attendee routes are **Partial Prerender**: static shell immediately, data streamed. TTFB 5–41 ms locally.
- Layout stability: CLS ≤ 0.002 — images have fixed aspect ratios, animations are transform/opacity only.
- JavaScript is ~205–216 KB per route, dominated by the React/Next runtime; page-specific client code is limited to the components listed in architecture.md.
- Images are sized per device by the Unsplash CDN (AVIF/WebP). Mobile `/discover` is heaviest (749 KB at 2.6 DPR): candidate for lower quality on high-DPR screens.
- **Load finding:** with 12 parallel browsers against one `next start` process and a 5-connection pool, payment starts exceeded 5 s. Cause: each pending-checkout poll ran a full maintenance pass. Fixed with a per-instance throttle (R-19); e2e now runs 4 workers with a 10-connection pool. Real capacity testing is M5 (k6).

## 6. Accessibility verification

- **Automated**: axe-core WCAG 2.1 A/AA on home, discover, discover-empty, event, sign-in, sign-up, checkout and wallet, desktop and mobile — **0 serious/critical violations** (enforced in CI).
- axe initially found real failures, now fixed: `graphite-500` text on dark (2.9:1 → `graphite-400`, 5.6:1) and violet text on raised panels (4.49:1 → new `violet-soft`, 6.1:1).
- **Reduced motion**: a real bug was found and fixed — titles were invisible for reduced-motion users because the first render branched on `useReducedMotion` (hydration mismatch). Now `MotionConfig reducedMotion="user"` with identical server/client markup; marquee and pulse disabled by CSS.
- **Keyboard**: skip link (tested), visible focus rings in accent colour, steppers are buttons with labelled actions and live quantity output (tested), Escape closes the mobile menu, radio group for simulator outcomes.
- **Semantics**: landmarks, one `h1` per page, labelled forms with `aria-invalid`/`aria-describedby`, `role="alert"` for errors, `aria-live` for checkout state, QR has a text alternative and the code is printed.
- Typography uses typographic apostrophes; times always show the event's time zone.

## 7. Automated test results

| Gate | Result |
| --- | --- |
| Typecheck, lint, boundaries (132 modules, 0 violations), migration drift | Pass |
| Vitest | **124 / 124** (17 files) |
| Playwright | **36 passed**, 12 skipped by design (capture and metrics are opt-in; keyboard and API-journey run on desktop only) |
| Build | Pass, all attendee routes Partial Prerender |

Mandatory scenarios (Playwright, desktop **and** mobile unless noted):

| Scenario | Test |
| --- | --- |
| Discovery → event → authentication → reservation → checkout → payment → ticket | `attendee-journey › discovery → … → ticket` (mobile uses the menu and the sticky reserve bar) |
| Failed payment and successful retry | `› a declined payment can be retried` |
| Expired reservation | `› an expired hold cannot be paid and says so` |
| Sold-out inventory | `› sold-out inventory cannot be selected` (Sunset Sessions) |
| Unauthorized ticket access | `› another attendee's ticket and checkout are not found` |
| Mobile checkout | every journey above on Pixel 7 |
| Refreshing during a pending payment | `› refreshing during a pending payment resumes and confirms` |
| AI absent without affecting navigation | `› the AI concierge is clearly not live and search works without it` (asserts no AI requests) |
| Sign-in required, selection survives | `› tickets and checkout require sign-in…`, journey test |
| Accessibility | `accessibility.spec.ts` (8 pages × 2 devices + keyboard) |

New unit/integration coverage: catalogue filters, facets, availability status, overdue holds, drafts/past events hidden,
LIKE-wildcard escaping, safe redirects (open-redirect, `//`, backslash, control characters), time-zone formatting,
malformed ids, payment reconciliation (§1).

## 8. Known limitations

- Concierge, living ticket and waitlist are honest placeholders (M3).
- No organizer or Control Center screens (M3/M4).
- No email verification, password reset or social sign-in.
- QR is display-only; no check-in or offline wallet.
- Imagery hotlinked from Unsplash; no CSP yet.
- Countdown is informational: when it reaches zero the page asks the server, which decides.
- Not deployed.

## 9. Security findings

| Finding | Status |
| --- | --- |
| Provider success after failure could escape reconciliation | Fixed (§1) |
| Payment idempotency not bound to parameters | Fixed (§1) |
| Malformed ids produced 500s through SQL casts | Fixed: `assertUuid` → 404 |
| Open redirect via `?next=` | Prevented by `safeRedirectPath` (unit-tested) |
| Client-carried selection could be stale or forged | Re-validated server-side against live availability; prices never come from the client |
| Polling could amplify load into resource exhaustion | Throttled (R-19) |
| New/updated risks | R-02 CSP (inputs now known), R-16 mitigated, R-17 hotlinked images, R-18 visible demo controls, R-19 throttle scope |

No Critical findings. No unmitigated High risk in shipped functionality.

## 10. Proposed M3 scope — AI and organizer intelligence

1. **Demand signals**: record no/low-result searches, sold-out item views and waitlist requests (activating the sold-out slot), keyed by attendee and deduplicated; seed the ~384-attendee Sunset Sessions demand through the same service (`origin = 'seed'`).
2. **AI Gateway**: Anthropic SDK, Haiku model from env, timeouts and bounded retries, token/cost records with a monthly budget, correlation ids, sanitized logging, graceful degradation.
3. **Business Action Registry** with the approval model in [ai-actions.md](../ai-actions.md): `events.search`, `experiences.read_availability`, `analytics.read`, `demand.analyze`, `experience.create_draft`, `experience.publish` (approval bound to a parameter hash, single use, expiry, re-authorization).
4. **Concierge** on `/discover` and the homepage slot, using registry read actions only; normal search keeps working when AI is unavailable.
5. **Organizer**: `/organizer` sales overview, `/organizer/intelligence` unmet-demand analysis with evidence, revenue assumptions and risks, `/organizer/approvals` for the AI-proposed second Sunset Session; publication makes it purchasable on the attendee side; sales attributed to the recommendation.

## 11. Decisions requested

1. Close the M2 review and authorize M3.
2. Provide Anthropic API access, confirm the Haiku model id available to the account, and set a monthly AI budget.
3. Confirm imagery may stay hotlinked for the demo, or approve copying it to project storage before deployment.
4. Neon and Vercel credentials when ready (still not required locally).
