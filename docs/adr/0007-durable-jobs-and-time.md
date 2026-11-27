# ADR-0007: PostgreSQL job queue; correctness independent of scheduling

Status: Accepted · 2026-11-27

## Context
Vercel functions do not run after a response unless asked (`after`), and Vercel Cron frequency depends on the
plan (Hobby: daily). Reservation expiry, delayed payment notifications, reconciliation and refunds need
background execution, but correctness must not depend on when, or whether, it runs.

## Decision
- A `jobs` table in PostgreSQL: atomic claiming with `FOR UPDATE SKIP LOCKED`, leases (`locked_until`),
  fencing by `locked_by`, bounded attempts with exponential backoff, `dead` state, optional dedupe keys.
  Jobs are enqueued inside the business transaction (transactional outbox). Handlers are idempotent.
- Execution: Vercel Cron (daily, `vercel.json`), a protected manual endpoint (`/api/operations/run`, bearer
  `CRON_SECRET`), and an opportunistic pass via `after()` when an attendee starts or polls a payment.
- Time-dependent correctness lives in the transactional path, using the database clock:
  - a reservation past `expires_at` is never accepted, regardless of job state;
  - availability treats overdue holds as free (read path), and reserving first expires overdue holds on the
    requested items (write path);
  - reads lazily expire overdue reservations.
- Composition root (`src/composition/runtime.ts`) binds job types to module handlers so modules stay acyclic.

## Consequences
+ No new infrastructure; jobs are inspectable with SQL; crashes recover via lease expiry.
+ Delayed or missing cron only delays housekeeping (refunds, notification delivery), never correctness.
− Throughput is bounded by PostgreSQL; adequate for the prototype. Production path: a managed queue
  (e.g. Vercel Queues / SQS) behind the same `enqueueJob` seam.
