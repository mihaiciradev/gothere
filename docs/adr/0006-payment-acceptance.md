# ADR-0006: Separate provider outcome from application acceptance

Status: Accepted · 2026-11-27 · Supersedes the "one success per reservation" constraint from M0.

## Context
M0 had a partial unique index allowing one `succeeded` attempt per reservation. Review found that a genuine
second provider success (retry after timeout, double submission) would then be rejected by the database and
could vanish from our records while the customer was charged.

## Decision
- `payment_attempts.status` records what the provider reported. Any number of attempts may be `succeeded`.
- `payment_attempts.disposition` records what we decided: `accepted` (at most one per reservation, partial
  unique index), `refund_required`, `refunded`. A check constraint ties dispositions to `succeeded`.
- Provider outcomes are written to `payment_provider_events` in their own transaction **before** processing.
- Acceptance happens only while holding the reservation row lock, only if the reservation is `active` and not
  past `expires_at` (database clock), and only if amount and currency equal the attempt's.
- Everything else (late, duplicate, mismatched) becomes `refund_required`; a refund job performs a simulated
  refund. MVP policy: a late success never tries to re-acquire inventory.
- At most one attempt may be in flight (`initiated`/`pending`); `unknown` does not block a retry.

## Consequences
+ No provider success can be lost or silently rejected; every one is either accepted or queued for refund.
+ Duplicate tickets are impossible (one accepted attempt → one order → unique ticket ordinals).
− Attendees can be charged twice in rare timeout+retry cases; this is visible and auto-refunded (simulated).
  A production provider would add idempotency keys on its side to reduce this further.

## Amendment (pre-M2 review)

A provider success after a `failed` attempt was ignored as stale, so money taken late (late capture, or a
failure we inferred from a 503) could escape reconciliation. Now `failed → succeeded` is a valid transition (domain
and trigger); locally inferred failures schedule a provider verification job; reconciliation queries failed attempts;
and `findUnreconciledProviderSuccesses` lists any provider success not ending in accepted/refund_required/refunded
(orphans, reference mismatches, unprocessed events). Payment Idempotency-Keys now store a request hash; reuse with
different parameters returns 409.
