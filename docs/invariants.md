# Invariants

Rules that must hold under concurrency, retries and partial failure. Each lists where it is enforced and which test proves it. "DB" means a PostgreSQL constraint that holds even if application code is wrong.

Status: ✅ enforced and tested · 🟡 enforced at DB, service pending · ⏳ planned (milestone).

## Inventory

| ID | Invariant | Enforcement | Test | Status |
| --- | --- | --- | --- | --- |
| INV-1 | Inventory is never oversold: `reserved + sold ≤ capacity` | DB `inventory_items_no_oversell`; guarded conditional `UPDATE` | `database-invariants › guarded concurrent reservations never exceed capacity`, `… unguarded … stopped by the check constraint` | ✅ DB · ⏳ M1 service |
| INV-2 | Counters are never negative | DB `inventory_items_{capacity,reserved,sold}_non_negative` | `database-invariants › rejects capacity overflow and negative counters` | ✅ |
| INV-3 | Inventory and experiences belong to the same tenant as their event | DB composite FKs `*_event_tenant_fk` | `database-invariants › tenant consistency` | ✅ |
| INV-4 | An `experience` inventory row references an experience of the same event; `admission` rows reference none | DB `inventory_items_kind_matches_experience`, `inventory_items_experience_event_fk` | — | 🟡 |

## Reservations and payments

| ID | Invariant | Enforcement | Status |
| --- | --- | --- | --- |
| RES-1 | Reservation creation is idempotent per `(user, idempotency_key)` | DB `reservations_user_idempotency_unique` | 🟡 M1 |
| RES-2 | An expired or released reservation returns its units to availability exactly once | Status transition `active → expired/released` in the same transaction as the counter decrement, conditional on `status = 'active'` | ⏳ M1 |
| RES-3 | Expiry and payment confirmation cannot both win | Both transitions are conditional updates on `status = 'active'`; the loser observes 0 rows and follows its compensating path | ⏳ M1 |
| RES-4 | A user cannot hoard inventory | Per-item `max_per_order` (DB-bounded 1–20) + per-user active reservation limit + rate limiting | ⏳ M1 |
| PAY-1 | Payments are simulated; no real money is processed | DB `payment_attempts_simulated_only` | ✅ |
| PAY-2 | At most one successful payment per reservation | DB partial unique index `payment_attempts_one_success_per_reservation` | ✅ |
| PAY-3 | Duplicate provider notifications have no additional effect | DB `payment_provider_events_unique (provider, provider_event_id)`; processing is a no-op if already processed | 🟡 M1 |
| PAY-4 | Payment attempt creation is idempotent per `(reservation, idempotency_key)` | DB `payment_attempts_reservation_idempotency_unique` | 🟡 M1 |
| PAY-5 | No transaction is held open across a provider call | Service structure: write intent → commit → call provider → new transaction to record result | ⏳ M1 |
| PAY-6 | A late success after expiry never oversells; it either re-reserves if available or flags `refund_required` | Reconciliation path | ⏳ M1 |

## Orders and tickets

| ID | Invariant | Enforcement | Test | Status |
| --- | --- | --- | --- | --- |
| ORD-1 | One order per reservation and per successful payment | DB `orders_reservation_id_unique`, `orders_payment_attempt_id_unique` | `database-invariants › one order per reservation …` | ✅ DB |
| TKT-1 | A successful order never issues duplicate tickets | DB `tickets_order_item_ordinal_unique (order, item, ordinal)`; issuance uses `ON CONFLICT DO NOTHING` | same test | ✅ DB · ⏳ M1 service |
| TKT-2 | Users can only read their own reservations, orders and tickets | Services filter by `actor.userId`; ids alone never grant access | — | ⏳ M1 |

## Tenancy, authorization and audit

| ID | Invariant | Enforcement | Test | Status |
| --- | --- | --- | --- | --- |
| TEN-1 | Organizer access requires a stored membership with a role granting the permission | `requireOrganizationPermission` reads membership from DB on every call | `organization-authorization.test.ts` | ✅ |
| TEN-2 | Cross-tenant access is indistinguishable from a missing tenant | Non-members receive `NOT_FOUND` | same | ✅ |
| TEN-3 | Platform administrators get no tenant write access by role alone | No implicit grant in the policy | same | ✅ |
| AUTH-1 | Clients cannot assign themselves roles | Better Auth `platformRole` has `input: false` | `authentication.test.ts` | ✅ |
| AUD-1 | Audit records are append-only | DB triggers reject `UPDATE`, `DELETE`, `TRUNCATE` | `database-invariants › audit records are append-only` | ✅ |

## AI and actions (M3)

| ID | Invariant |
| --- | --- |
| ACT-1 | Every action execution passes the same authorization as a human request; the model never chooses its own permissions. |
| ACT-2 | HIGH-risk actions initiated by AI require an approval bound to a hash of the exact canonical parameters. |
| ACT-3 | An approval executes at most once, expires, and is revalidated (permissions and preconditions) at execution time. |
| ACT-4 | AI is never on the critical purchase path; ticketing works with AI unavailable. |
| ACT-5 | AI-produced figures reference application data; estimates are labelled and stored separately from actual revenue. |
