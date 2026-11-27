# Invariants

Rules that must hold under concurrency, retries and partial failure. Each lists where it is enforced and which test
proves it. "DB" means a PostgreSQL constraint or trigger that holds even if application code is wrong.
State machines: [state-machines.md](state-machines.md).

Status: ✅ enforced and tested · ⏳ planned (milestone).

## Inventory

| ID | Invariant | Enforcement | Test | Status |
| --- | --- | --- | --- | --- |
| INV-1 | Never oversold: `reserved + sold ≤ capacity` | DB `inventory_items_no_oversell`; single guarded `UPDATE` per line | `reservations › concurrent buyers never oversell` (30 buyers / 10 units → 10), `database-invariants › guarded/unguarded increments` | ✅ |
| INV-2 | Counters never negative | DB non-negative checks; release/commit guarded by `reserved >= qty` | `database-invariants › capacity overflow and negative counters` | ✅ |
| INV-3 | Inventory and experiences belong to their event's tenant | DB composite FKs `*_event_tenant_fk` | `database-invariants › cross-tenant…` | ✅ |
| INV-4 | Multi-line reservations are all-or-nothing, locked in id order | One transaction; `inLockOrder`; any failing line throws | `reservations › multi-item … roll back completely`, `… opposite line orders do not deadlock` | ✅ |
| INV-5 | Prices and currency are server-side | Captured from the locked inventory row; strict request schema | `reservations › rejects client-supplied prices`, `… captures prices at reservation time`, `http-api › rejects client-supplied prices` | ✅ |

## Reservations

| ID | Invariant | Enforcement | Test | Status |
| --- | --- | --- | --- | --- |
| RES-1 | Idempotency key bound to parameters | `(user, key)` unique + `request_hash`; mismatch → 409 | `reservations › rejects reusing a key…`, `… concurrent requests with the same key…` | ✅ |
| RES-2 | Expired/released holds return units exactly once | `closeReservation` conditional on `active`; DB transition trigger | `reservations › expired reservations release inventory exactly once` | ✅ |
| RES-3 | Expiry and confirmation cannot both win | Both take the reservation row lock and re-check status and DB-clock expiry | `payments › concurrent expiry and confirmation…` (20 runs, both outcomes observed) | ✅ |
| RES-4 | Per-user active hold cap cannot be bypassed concurrently | Per-user advisory transaction lock around count + insert | `reservations › … cannot bypass the active reservation cap` (12 concurrent → 3) | ✅ |
| RES-5 | Line items belong to the reservation's event | DB FKs `(reservation_id, event_id)` and `(inventory_item_id, event_id)` | `database-invariants › reservation line … different event` | ✅ |
| RES-6 | Correctness without the expiry job | DB-clock checks at payment start/acceptance; overdue holds free in availability and swept before reserving | `reservations › does not let an overdue hold block…`, `payments › overdue but not yet swept…` | ✅ |

## Payments

| ID | Invariant | Enforcement | Test | Status |
| --- | --- | --- | --- | --- |
| PAY-1 | Payments are simulated | DB `payment_attempts_simulated_only`; responses carry `simulated: true` | `database-invariants › rejects non-simulated payments` | ✅ |
| PAY-2 | Every provider success is recorded | Provider event recorded in its own transaction before processing; no uniqueness on `succeeded` | `payments › records every success…`, `… processing never ran … recovered` | ✅ |
| PAY-3 | At most one accepted payment per reservation | Partial unique index on `disposition = 'accepted'` | `database-invariants › records several provider successes but accepts at most one` | ✅ |
| PAY-4 | Duplicate notifications have no extra effect | Event-id dedup + duplicate-status ignore | `payments › duplicate notifications…` | ✅ |
| PAY-5 | Out-of-order notifications cannot regress state | Domain transition table + DB trigger | `payments › out-of-order…`, `database-invariants › invalid payment state transitions` | ✅ |
| PAY-6 | No transaction across a provider call | Attempt committed → provider call → new transactions | Code structure (`payments/service.ts`) | ✅ |
| PAY-7 | Late success never oversells or issues tickets | Accept only active + unexpired; otherwise `refund_required` | `payments › a success after expiry and resale…` | ✅ |
| PAY-8 | Amount charged equals amount captured | Attempt amount copied from reservation; mismatching provider amount never accepted; amount immutable (trigger) | `payments › … different amount…`, `database-invariants › … edits to recorded amounts` | ✅ |
| PAY-9 | Unauthenticated callers cannot confirm payments | HMAC signature + 5-minute window before parse/store; acceptance still requires a matching attempt | `payments › rejects unsigned, tampered and stale…`, `http-api › rejects unsigned…` | ✅ |

## Orders and tickets

| ID | Invariant | Enforcement | Test | Status |
| --- | --- | --- | --- | --- |
| ORD-1 | One order per reservation, paid by an attempt of that reservation, owned by its user | DB unique + composite FKs | `database-invariants › rejects an order paid by another reservation's attempt…` | ✅ |
| TKT-1 | No duplicate tickets | Unique `(order, item, ordinal)`; one accepted attempt | `payments › duplicate notifications…`, `database-invariants › tickets…` | ✅ |
| TKT-2 | Tickets only for items reserved on that order, for that user | DB FKs to `reservation_items` and `orders(id, reservation, user, event)` | `database-invariants › rejects tickets for items that were not reserved` | ✅ |
| TKT-3 | Users only read their own reservations, payments, orders, tickets | Queries filter by `actor.userId`; ids alone grant nothing | `reservations › rejects access to another user's reservation`, `http-api › … visible only to the owner` | ✅ |

## Tenancy, authorization and audit

| ID | Invariant | Enforcement | Test | Status |
| --- | --- | --- | --- | --- |
| TEN-1 | Organizer mutations require a stored membership granting the permission | `requireOrganizationPermission` inside the mutation transaction | `organizer › rejects mutations by members without the permission` | ✅ |
| TEN-2 | Cross-tenant access looks like a missing resource | Non-members → `NOT_FOUND`; tenant taken from the stored row | `organizer › rejects cross-tenant mutations…` | ✅ |
| TEN-3 | Platform admins have no implicit tenant access | Policy | `organization-authorization` | ✅ |
| AUTH-1 | Clients cannot assign roles | Better Auth `input: false` | `authentication` | ✅ |
| AUTH-2 | Cookie-authenticated mutations are same-origin | `assertSameOrigin` in the route wrapper | `http-api › rejects cross-site…` | ✅ |
| AUD-1 | Audit records are append-only | DB triggers | `database-invariants › audit records` | ✅ |

## Background jobs

| ID | Invariant | Enforcement | Test | Status |
| --- | --- | --- | --- | --- |
| JOB-1 | A job is claimed by one worker at a time | `FOR UPDATE SKIP LOCKED` + lease | `jobs › concurrent workers never claim the same job twice` (6 workers, 30 jobs) | ✅ |
| JOB-2 | Interrupted jobs recover; stale workers are fenced | Lease expiry re-claim; `locked_by` on completion | `jobs › recovers a job whose worker crashed…` | ✅ |
| JOB-3 | Retries are bounded | `max_attempts`, backoff, `dead` | `jobs › retries failures…`, `… buries a job…` | ✅ |
| JOB-4 | Jobs commit with their business change | Enqueue inside the transaction | `jobs › enqueued jobs roll back…` | ✅ |

## AI and actions (M3)

| ID | Invariant | Status |
| --- | --- | --- |
| ACT-1 | Every action passes the same authorization as a human request; the model never chooses its permissions | ⏳ M3 |
| ACT-2 | HIGH-risk AI actions require an approval bound to a hash of canonical parameters | ⏳ M3 |
| ACT-3 | Approvals execute at most once, expire, and are revalidated at execution | ⏳ M3 |
| ACT-4 | AI is never on the critical purchase path | ✅ by construction (no AI code in M1); ⏳ test in M3 |
| ACT-5 | AI figures reference application data; estimates separate from actual revenue | ⏳ M3 |
