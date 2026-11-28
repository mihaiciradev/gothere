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
| PAY-2 | Every provider success is recorded and reconciled, including one that follows a failure | Provider event recorded before processing; `failed → succeeded` allowed; inferred failures verified with the provider; `findUnreconciledProviderSuccesses` report | `payments › records every success…`, `… processing never ran …`, `payment-reconciliation` (5 tests) | ✅ |
| PAY-3 | At most one accepted payment per reservation | Partial unique index on `disposition = 'accepted'` | `database-invariants › records several provider successes but accepts at most one` | ✅ |
| PAY-4 | Duplicate notifications have no extra effect | Event-id dedup + duplicate-status ignore | `payments › duplicate notifications…` | ✅ |
| PAY-5 | Out-of-order notifications cannot regress state | Domain transition table + DB trigger | `payments › out-of-order…`, `database-invariants › invalid payment state transitions` | ✅ |
| PAY-6 | No transaction across a provider call | Attempt committed → provider call → new transactions | Code structure (`payments/service.ts`) | ✅ |
| PAY-7 | Late success never oversells or issues tickets | Accept only active + unexpired; otherwise `refund_required` | `payments › a success after expiry and resale…` | ✅ |
| PAY-8 | Amount charged equals amount captured | Attempt amount copied from reservation; mismatching provider amount never accepted; amount immutable (trigger) | `payments › … different amount…`, `database-invariants › … edits to recorded amounts` | ✅ |
| PAY-10 | Payment Idempotency-Keys are bound to their request | `(reservation, key)` unique + `request_hash` of reservation and scenario; mismatch → 409; hash immutable (trigger) | `payment-reconciliation › payment idempotency` | ✅ |
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

## AI, actions and demand (M3)

| ID | Invariant | Enforcement | Test | Status |
| --- | --- | --- | --- | --- |
| ACT-1 | Every action passes the same authorization as a human request; the model never chooses its permissions or tenant | `invokeAction`: DB membership check, tenant from server context, referenced resources pinned to it, strict input | `governed-actions › rejects actions from non-members…`, `… pins resources to the context tenant`, `… rejects unknown keys…` | ✅ |
| ACT-2 | HIGH-risk actions from an agent or automation wait for a human approval bound to a hash of canonical parameters | `approval: when_not_human`; `action_requests.params_hash`; the approver submits the hash they reviewed | `… holds publication for a human`, `… rejects an approval for parameters other than the ones reviewed` | ✅ |
| ACT-3 | Approvals execute at most once, expire, and are re-validated (requester and approver permissions, preconditions) at execution | Conditional `approved → executed` in the effect's transaction; trigger-guarded immutability; expiry | `… exactly once under concurrent execution`, `… expires requests…`, `… re-checks the requester's permission…`, `… refuses to publish a draft that changed…`, `… makes stored parameters immutable…` | ✅ |
| ACT-4 | AI is never on the critical purchase path | No AI code in reservations or payments; the concierge holds read-only tools | `ai-gateway › falls back to deterministic search when the provider fails, and ticketing is unaffected` | ✅ |
| ACT-5 | Recommendation figures come from application data; estimates are separate from actual revenue | Pure `proposeAdditionalSession`; briefs stored only if every number is grounded; outcomes from live orders only | unit `intelligence`, `ai-gateway › keeps the rules narrative when…` | ✅ |
| ACT-6 | Concierge picks exist in the catalogue and show database prices | Picks filtered to tool-returned slugs; cards hydrated from the DB; money in model prose replaced | `ai-gateway › only recommends what its tools returned…` | ✅ |
| ACT-7 | AI spend never exceeds the monthly budget, even under concurrency | Atomic worst-case reservation (advisory lock) before every provider call, settled afterwards | `ai-gateway › never lets concurrent requests exceed the budget…`, `› stops calling the provider once…`, `› keeps the reserved cost after a timeout…` | ✅ |
| DEM-1 | A person counts once per item (waitlist) or per item and day (views, searches); identities are not stored as subjects | Keyed-hash subjects; partial unique indexes | `demand-signals › …` | ✅ |
| DEM-2 | Demand signals belong to the tenant of their event | Composite foreign keys | `demand-signals › rejects a signal whose event belongs to a different tenant…` | ✅ |

## Engineering intelligence (M4)

| ID | Invariant | Enforcement | Test | Status |
| --- | --- | --- | --- | --- |
| INC-1 | At most one unresolved incident per fingerprint; occurrences attach to it; resolution is terminal | Partial unique index + advisory lock in the recorder | `incidents › attaches repeated occurrences to one open incident…` | ✅ |
| INC-2 | Severity only rises | `higherSeverity` in the recorder | `incidents › only ever raises severity…`, unit | ✅ |
| INC-3 | A persistent condition counts once per dedupe key | Unique (fingerprint, dedupe_key) | `incidents › records a persistent condition once…`, detector tests | ✅ |
| INC-4 | Stored evidence contains no secrets or personal data and is append-only | `sanitize` before storage; trigger | `incidents › sanitizes messages and contexts…`, unit sanitization | ✅ |
| INC-5 | Commercial impact uses recorded amounts only; failed requests are never priced | `domain/impact.ts` | unit `counts money only from recorded amounts…`, detector tests | ✅ |
| INC-6 | Control Center and platform actions are for platform admins, read from the database | `requirePlatformAdminById` | `incidents › is for platform administrators only…` (forged session role rejected) | ✅ |
| INC-7 | External investigations never run without a human approval, at any severity, and are never reported as executed unless they were | `approval: "always"`; content-hash binding; no adapter connected | `incidents › never runs an external investigation without approval, even for a P0…` | ✅ |
| INC-8 | The engineering agent sees only the sanitized report and its causes cite real evidence | Report-only prompt; citation filter; runbook fallback | `incidents › keeps causes that cite real evidence…`, `› falls back to the runbook…` | ✅ |
| INC-9 | Simulated incidents never mix with live telemetry and are refused in production | `origin` on events and incidents; fingerprints include origin | `incidents › simulated incidents are labelled…` | ✅ |
