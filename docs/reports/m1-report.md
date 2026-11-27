# M1 implementation report — Transactional ticketing engine

| | |
| --- | --- |
| Milestone | M1 — Transactional ticketing engine |
| Status | Complete. **Awaiting independent review.** M2 not started. |
| Baseline | `15cf588` (M0, CI green) |
| Report date | 2026-11-27 |

Authoritative details: [state-machines.md](../state-machines.md), [invariants.md](../invariants.md), [api.md](../api.md),
[security.md](../security.md), ADRs [0006](../adr/0006-payment-acceptance.md) and [0007](../adr/0007-durable-jobs-and-time.md).

---

## 1. Implemented functionality

| Capability | Where | Notes |
| --- | --- | --- |
| Published catalogue | `events/catalog.ts`, `GET /api/events[/:slug]` | Upcoming published events; experiences and items with live availability and sold-out flags |
| Real-time availability | `inventory/availability.ts` | `capacity − sold − held`, where holds past expiry count as free — correct with no job running |
| Organizer management | `events/management.ts`, `inventory/management.ts`, 6 organizer routes | Create/update events with lifecycle rules; draft experience + draft inventory; separately permissioned publish; capacity/price/status updates (capacity ≥ reserved + sold); all audited |
| Atomic reservations | `inventory/units.ts`, `reservations/service.ts` | One guarded `UPDATE` per line in id order inside one transaction; prices captured from the locked row |
| Reservation limits | `reservations/service.ts` | ≤ 3 active holds per user under a per-user advisory lock; `max_per_order`; 10-minute TTL |
| Idempotency | `reservations`, `payments` | `(user, key)` + request hash for reservations; `(reservation, key)` for payment attempts |
| Expiry and recovery | `closeReservation`, `expireReservation`, sweeps | Exactly-once release; lazy expiry on read, at payment, before reserving; plus jobs |
| Simulated payments | `payments/service.ts`, `payments/simulator.ts` | Scenarios: success, decline, delayed_success, duplicate_notification, out_of_order, timeout, unavailable; ledger labelled as simulator |
| Provider event pipeline | `payments/processing.ts` | Record (own transaction, deduplicated) → process (locked, atomic) |
| Reconciliation | `payments/reconciliation.ts` | Timeouts/unknown, stuck `initiated`/`pending`, unprocessed events; asks the provider |
| Order confirmation and tickets | `ticketing/confirmation.ts` | Order + `reserved → sold` + one ticket per unit, one transaction; 80-bit Crockford codes |
| Simulated refunds | `processSimulatedRefund` + job | For late, duplicate and mismatched successes |
| Durable jobs | `operations/jobs.ts` | SKIP LOCKED claiming, leases, fencing, bounded retries with backoff, dead state, dedupe keys, transactional enqueue |
| HTTP layer | `app/api/_lib`, 16 endpoints | Correlation ids, CSRF origin check, strict Zod bodies, uniform errors, per-user DB rate limits |
| Structured logging | `infrastructure/request-context.ts`, logger | Correlation id per request, carried into jobs |
| Demonstration data | `scripts/seed-history.ts` | 240 historical orders through the real services, `origin = 'seed'`; Sunset Sessions sold out |

Not in scope and not built: UI (M2), AI (M3), incidents/Control Center (M4), real payments or refunds.

## 2. State machines

Full specification with every transition and the scenario matrix: [state-machines.md](../state-machines.md). Summary:

- **Reservation**: `active → converted | expired | released`; all others terminal. Single exit path (`closeReservation`), conditional on `active`; DB trigger rejects any other transition.
- **Payment status** (provider fact): `initiated → pending | succeeded | failed | unknown`, `pending → succeeded | failed | unknown`, `unknown → pending | succeeded | failed`; `succeeded`/`failed` terminal. Duplicates ignored, out-of-order statuses ignored as stale. DB trigger mirrors the table and makes amount/currency/reservation immutable.
- **Payment disposition** (application decision): `none → accepted | refund_required`, `refund_required → refunded`. Accept only if the reservation is `active`, not past `expires_at` by the DB clock, and amounts match; otherwise refund.
- **Job**: `queued → running → succeeded | dead`, `running → queued` on retry, expired leases re-claimable.

Policy decisions requested by the review, implemented as specified:

| Case | Policy |
| --- | --- |
| Provider success vs acceptance vs order | Separate columns/tables; every success recorded; one acceptance; one order |
| Duplicate successful attempts | Second success → `refund_required:duplicate_success` → simulated refund |
| Late success after expiry | Never re-reserves; `refund_required:late_success`; no tickets |
| Ambiguous/delayed | `unknown`/`pending`, resolved by notifications or reconciliation |
| Rejected insert must not lose a success | Provider event committed before processing; failures leave it for reconciliation |

## 3. Schema changes

Migrations `0002_transactional_integrity.sql` (generated, reordered so unique keys precede the composite FKs that need them) and `0003_state_machine_guards.sql` (triggers).

| Change | Purpose |
| --- | --- |
| `reservation_items.event_id` + FKs `(reservation_id, event_id)` and `(inventory_item_id, event_id)` | A line can only hold inventory of its reservation's event |
| `orders` FKs `(reservation_id, user_id, event_id)` → reservations, `(payment_attempt_id, reservation_id)` → payment_attempts | Order matches its reservation's user/event and is paid by that reservation's attempt |
| `tickets.reservation_id` + FKs `(order_id, reservation_id, user_id, event_id)` → orders, `(reservation_id, inventory_item_id)` → reservation_items | Tickets only for reserved items, for the order's owner |
| Supporting unique keys on inventory_items, reservations, payment_attempts, orders | Targets for the composite FKs |
| Dropped `payment_attempts_one_success_per_reservation` | Provider successes must always be recordable |
| `payment_attempts.disposition` + `one_accepted_per_reservation`, `one_in_flight_per_reservation`, `disposition_requires_success` | Acceptance uniqueness; no parallel attempts |
| `reservations.request_hash`, `closed_at` (+ check) | Idempotency binding; closure timestamp |
| `payment_provider_events.provider_reference`, `outcome` (+ check), unprocessed index | Durable, auditable processing |
| `jobs`, `api_rate_limits`, `simulator_payments` | Durable jobs, rate limiting, simulator ledger |
| Triggers on reservations and payment_attempts | State machines and immutability enforced by the database |

## 4. Architectural decisions

| Decision | Trade-off |
| --- | --- |
| [ADR-0006](../adr/0006-payment-acceptance.md) Provider outcome separate from acceptance | Rare double charges become visible auto-refunds instead of lost records |
| [ADR-0007](../adr/0007-durable-jobs-and-time.md) PostgreSQL job queue; time correctness in the transactional path | Queue throughput bounded by Postgres; a managed queue can replace it behind `enqueueJob` |
| Per-user advisory transaction lock for the cap and idempotency | Serializes one user's concurrent reservation attempts (intended); other users unaffected |
| Lock order event → reservation → attempt → inventory by id | Verified with opposite-order concurrent buyers (no deadlock) |
| Composition root `src/composition/runtime.ts` | Keeps payments ↔ reservations ↔ jobs acyclic; boundary rules extended and green |
| Simulator persisted in its own ledger table and delivering signed notifications through the real webhook path | Exercises verification, delays, duplicates and reconciliation without network calls |
| Overdue holds counted as free in availability; requested items swept before reserving | A late or missing cron never blocks buyers |
| Seed history through services; only timestamps rewritten afterwards | Counters and tickets are guaranteed consistent; timestamps are cosmetic history |

## 5. Security controls

New in M1 (full list: [security.md](../security.md#controls-in-place-m0m1)):

- Attendee ownership on every reservation, payment, order and ticket read/write (foreign ids → 404).
- Organizer permission check inside every mutation transaction; tenant derived from the stored row.
- CSRF: cookie-authenticated non-GET requests must come from our origin (403 otherwise).
- Signed provider notifications (HMAC-SHA256, 5-minute window, constant-time) verified before parsing or storage. No unauthenticated path can confirm a payment; even a valid notification needs a matching attempt, an active unexpired reservation and the exact amount.
- Simulator scenarios gated by `PAYMENT_SIMULATOR_SCENARIOS` (off outside local/test by default).
- Job runner behind `CRON_SECRET` bearer (constant time).
- Hoarding limits (cap, per-order limit, TTL, per-user DB rate limits).
- Admin demo account not seeded in preview/production by default; synthetic buyers have no credentials.
- Least-privilege role script validated locally: app role can write data, cannot run DDL, cannot alter audit records.
- All M0 controls preserved; boundaries: 0 violations across 89 modules.

## 6. Actual test results

Local run, 2026-11-27, Windows 11, Node 24.22.3, PostgreSQL 17 (Docker):

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| `pnpm boundaries` | Pass — 0 violations (89 modules, 267 dependencies) |
| `pnpm drizzle-kit check` | Pass |
| Vitest | **103 / 103 passed** in 20.5 s (23 unit, 80 integration) |
| `pnpm build` | Pass; all 16 API routes dynamic |
| Playwright | **5 passed, 1 skipped** (API journey runs on desktop only by design) |
| `pnpm db:seed` twice | 240 seed orders, second run skipped |
| `pnpm audit --prod` | 1 moderate (R-09, unchanged), 0 high/critical |

| Suite | Tests |
| --- | --- |
| integration/payments | 19 |
| integration/reservations | 15 |
| integration/database-invariants | 15 |
| integration/http-api | 10 |
| integration/organizer | 7 |
| integration/jobs | 6 |
| integration/authentication, organization-authorization | 4 + 4 |
| unit (5 files) | 23 |

### Concurrency results (real PostgreSQL)

| Scenario | Setup | Observed |
| --- | --- | --- |
| Oversell | 30 buyers, 1 unit each, capacity 10 | exactly 10 reservations; 20 × `CONFLICT insufficient_inventory`; `reserved = 10` |
| Cap bypass | 12 concurrent requests, one user, distinct keys, cap 3 | exactly 3 succeed; `reserved = 3` |
| Same idempotency key | 8 concurrent identical requests | 1 reservation; `reserved = 2` (one request's quantity) |
| Deadlock | 16 buyers, two items, opposite line orders | all succeed; no deadlock |
| Expire exactly once | 10 concurrent `expireReservation` + sweep + lazy read | ≤ 1 winner; `reserved = 0` |
| Expiry vs confirmation race | 20 runs, expiry 0–40 ms away, concurrent expirer and notification | both outcomes observed (e.g. 12/8, 15/5 converted/expired across runs); every run consistent: converted ⇒ 1 order, 1 ticket, sold 1; expired ⇒ 0 orders, refund; `reserved = 0` always |
| Late success after resale | capacity 2, first holder expires, rival buys 2, late success arrives | rival accepted; late payment `refunded`; `sold = 2 = capacity`, 0 tickets for the late payer |
| Job claiming | 6 workers, 30 jobs | 30 claims, 30 distinct |
| Guarded vs unguarded DB increments | 40 / 20 concurrent | exactly capacity succeed in both |

### Mutation checks

To confirm the tests detect regressions, two protections were removed temporarily and restored afterwards:

| Mutation | Result |
| --- | --- |
| Remove the per-user advisory lock | cap test failed: **12 of 12** concurrent requests got through instead of 3 |
| Accept successes for overdue-but-unswept reservations | late-success test failed |

### Bug found by the tests

`getEventAvailability` referenced `inventory_items.id` inside a correlated subquery that Drizzle rendered unqualified (`"id"`), making it ambiguous; the public event endpoint would have returned 500. Found by the organizer publish test; fixed, and a similar subquery in `reserveUnits` was rewritten with explicit qualification.

### CI

`.github/workflows/ci.yml` now seeds twice (idempotency) before e2e and provides CI-only secrets. **Not yet run on GitHub** — these commits are local until pushed.

## 7. Remaining risks

| ID | Risk | Severity |
| --- | --- | --- |
| R-01 | No email verification (multi-account hoarding residual) | Medium |
| R-02 | No CSP yet (M5) | Medium |
| R-03 | Hoarding by many accounts | Medium (was High) |
| R-04, R-05 | Prompt injection; approval tampering (M3) | High (feature not built) |
| R-06 | AI cost (M3) | Medium |
| R-10 | Roles prepared, not applied (no Neon yet) | Medium |
| R-12 | Double charge after timeout + retry (auto-refunded, simulated) | Medium |
| R-13 | Leaked webhook secret | Medium |
| R-14–R-16 | Per-user (not IP) limits; `after()` work; release during pending payment ends as refund | Low |

No Critical findings. No unmitigated High risk in M1 functionality; R-04/R-05 concern M3 features.

## 8. Required environment variables

| Variable | Required | New in M1 |
| --- | --- | --- |
| `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | yes | — |
| `PAYMENT_WEBHOOK_SECRET` | yes (≥ 32) | ✅ |
| `CRON_SECRET` | for the job runner / Vercel Cron (≥ 32) | ✅ |
| `PAYMENT_SIMULATOR_SCENARIOS` | optional (`enabled`/`disabled`) | ✅ |
| `SEED_ALLOW_ADMIN` | optional | ✅ |
| `APP_ENV`, `LOG_LEVEL`, `DATABASE_POOL_MAX`, `TEST_DATABASE_URL`, `SEED_*_PASSWORD` | as in M0 | — |

`OPERATIONS_SECRET` (planned in M0) was replaced by `CRON_SECRET`, the name Vercel Cron uses.

## 9. Known limitations

- No UI; no sign-in screen (API only). M2.
- One currency per reservation; no fees; no ticket transfer, check-in or QR rendering.
- No order-level refunds or cancellations; refunds exist only for unaccepted provider successes.
- Organizer analytics limited to capacity/sold per event (M3).
- Vercel Cron daily on Hobby; deployed demos rely on polling-triggered `after()` passes or the protected runner for delayed notifications.
- `after()` passes and the runner process jobs serially within one invocation.
- Not deployed; Neon/Vercel not configured; CI changes not yet executed on GitHub.

## 10. Proposed M2 scope — Attendee experience

1. Visual system on existing tokens; sign-in/sign-up screens on Better Auth; session-aware layout.
2. `/` and `/discover`: editorial, mobile-first discovery (no AI yet; concierge slot reserved for M3).
3. `/events/[slug]`: event page, experiences, live availability, sold-out and "notify me" placeholder for M3 demand capture.
4. `/checkout/[reservationId]`: hold countdown from `expiresAt`, simulated payment with a clearly labelled scenario picker where enabled, pending/declined/expired/refunded states, polling.
5. `/tickets`, `/tickets/[id]`: digital tickets with code and QR; companion stub.
6. Server components calling module services directly (same services as the API); Playwright journeys desktop + mobile; reduced motion and contrast checks.

## 11. Commits

| Title |
| --- |
| Harden transactional schema |
| Add transactional ticketing engine |
| Add M1 API endpoints |
| Seed sales history through services |
| Document M1 |

## 12. Decisions requested

1. Provide Neon and Vercel credentials when ready (approved in principle); M1 runs fully on local PostgreSQL.
2. Confirm simulator scenarios stay **disabled** on any public demo (recommended) or enable them for the presentation only.
3. Confirm the admin account stays unseeded on preview (recommended).
4. Accept daily Vercel Cron (Hobby) or approve a plan that allows more frequent runs; correctness does not depend on it.
5. Close the M1 review and authorize M2.
