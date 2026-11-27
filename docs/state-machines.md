# State machines

Authoritative transitions for the transactional core. Each machine is enforced three times: pure domain code
(`src/modules/*/domain`), conditional `UPDATE … WHERE status = …` in services, and database triggers
(`drizzle/0003_state_machine_guards.sql`).

## Reservation

```text
             ┌──────────── converted   (an accepted payment; units move reserved → sold)
 active ─────┼──────────── expired     (expires_at passed; units released)
             └──────────── released    (attendee gave up the hold; units released)
```

| From | To | Trigger | Effect |
| --- | --- | --- | --- |
| active | converted | provider success accepted while `expires_at > now()` (DB clock) | order + tickets + `commitUnits`, one transaction |
| active | expired | expiry job, lazy expiry on read, payment start/processing on an overdue reservation, sweep before reserving the same items | `releaseUnits` once |
| active | released | `DELETE /api/reservations/:id` by the owner | `releaseUnits` once |

Terminal: `converted`, `expired`, `released`. `closeReservation` is the only code path out of `active`; it is
conditional on `status = 'active'`, so of several concurrent closers exactly one wins and units are returned once.
Holds last 10 minutes (`RESERVATION_TTL_SECONDS`). An overdue hold is never accepted, whether or not a job ran.

## Payment attempt — provider status (`status`)

What the provider says happened.

```text
 initiated ──► pending ──► succeeded
     │  │         │   └──► failed
     │  │         └──────► unknown ──► pending | succeeded | failed
     │  └──► succeeded | failed | unknown
```

| Status | Meaning |
| --- | --- |
| initiated | Attempt row committed; provider call not yet answered |
| pending | Provider accepted the request; confirmation will follow (delayed scenario) |
| unknown | Provider call timed out or errored ambiguously; reconciliation must ask the provider |
| succeeded | Provider took the money (simulated). Always recorded, never rolled back |
| failed | Provider definitively did not take the money (decline, unavailable, not received) |

`succeeded` and `failed` are terminal. A duplicate status is ignored; an out-of-order status (e.g. `pending` after
`succeeded`) is ignored as stale. At most one attempt per reservation may be `initiated`/`pending` at once;
`unknown` does not block a retry (a retry can therefore produce a second provider success — handled below).

## Payment attempt — application decision (`disposition`)

What the application did with a provider success. Independent of `status`.

```text
 none ──► accepted
   └────► refund_required ──► refunded (simulated)
```

| Decision input (inside one transaction holding the reservation lock) | Disposition | Reservation |
| --- | --- | --- |
| reservation `active`, not overdue, amount and currency match | `accepted` | → converted, order + tickets |
| reservation `active` but overdue | `refund_required` (late_success) | → expired, units released |
| reservation `expired` or `released` | `refund_required` (late_success) | unchanged |
| reservation `converted` (another attempt was accepted) | `refund_required` (duplicate_success) | unchanged |
| amount or currency differ from the attempt | `refund_required` (amount_mismatch) | unchanged (or expired if overdue) |

`disposition ≠ none` requires `status = succeeded` (check constraint). At most one `accepted` per reservation
(partial unique index). `refund_required` enqueues a refund job in the same transaction; the job calls the
simulator's refund and sets `refunded`. No real money moves in either direction.

## Provider event processing

1. **Record** (own transaction): insert into `payment_provider_events`, deduplicated on `(provider, provider_event_id)`.
   Sources: verified webhook, synchronous provider response, reconciliation query.
2. **Process** (one transaction): lock event → reservation → attempt → inventory rows in id order; apply the
   status transition; decide disposition; write order/tickets/audit; mark the event processed with an `outcome`.
3. If processing throws, the event stays unprocessed and the reconciliation sweep retries it. A provider success
   is therefore never lost, even if acceptance is rejected or the process crashes.

Outcomes: `accepted`, `refund_required:{late_success|duplicate_success|amount_mismatch}`, `recorded_pending`,
`recorded_failed`, `ignored_duplicate`, `ignored_stale`, `orphan` (no such attempt), `reference_mismatch`.

## Scenarios covered

| Scenario | Path | Test |
| --- | --- | --- |
| Success | sync response → accepted; later webhook → ignored_duplicate | `payments › success confirms the order…` |
| Failure and retry | decline → failed; hold kept; new attempt | `payments › a declined payment…` |
| Provider unavailable | attempt failed `provider_unavailable`, nothing charged | `payments › provider unavailability…` |
| Delayed confirmation | pending → webhook job → accepted | `payments › delayed confirmation…` |
| Ambiguous (timeout) | unknown → reconcile job queries provider → accepted | `payments › a timed-out payment…` |
| Duplicate notifications | dedup by event id + duplicate-status ignore | `payments › duplicate notifications…` |
| Out-of-order notifications | stale status ignored | `payments › out-of-order notifications…` |
| Two provider successes | one accepted, the other refund_required → refunded | `payments › records every success…` |
| Late success after expiry and resale | refund_required, no tickets, no oversell | `payments › a success after expiry and resale…` |
| Expiry racing confirmation | exactly one consistent outcome | `payments › concurrent expiry and confirmation…` |
| Crash between record and process | reconciliation processes the stored event | `payments › a recorded success whose processing never ran…` |

## Background job

```text
 queued ──claim──► running ──► succeeded
   ▲                 │  └────► dead        (failed on final attempt, or lease expired on final attempt)
   └── retry ◄───────┘                     (failed; run_at = now + backoff)
 running with expired lease ──claim──► running (another worker; attempts + 1)
```

Claiming is `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`. Completion and failure are fenced by
`locked_by`, so a worker that lost its lease cannot overwrite the new owner's result.
