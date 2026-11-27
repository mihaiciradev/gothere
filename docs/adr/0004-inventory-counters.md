# ADR-0004: Inventory as guarded counters with database constraints

Status: Accepted · 2026-11-27

## Context
Inventory must never be oversold or go negative, under concurrent reservations, expiries and late payments, on serverless instances with no shared memory.

## Decision
- One `inventory_items` row per sellable unit (admission type or experience session) with `capacity`, `reserved`, `sold`.
- Reserve: single statement `UPDATE … SET reserved = reserved + :q WHERE id = :id AND capacity - reserved - sold >= :q RETURNING`. Zero rows = not available. No read-then-write.
- Commit on payment success: `reserved -= q, sold += q` in the same transaction as the order and tickets. Release on expiry/failure: `reserved -= q`, conditional on the reservation's status transition.
- Check constraints (`reserved + sold <= capacity`, non-negative counters) as a backstop that holds even if a service is wrong.

## Consequences
+ O(1) availability reads, no row-per-seat explosion, contention limited to one row per item.
+ Proven by concurrency tests against real Postgres.
− A very hot item serializes on one row. Production path: sharded counters or admission-controlled waiting room in front (documented in the M5 scaling plan).
Rejected: row-per-unit inventory (heavier, unnecessary without assigned seating); Redis counters (second source of truth).
