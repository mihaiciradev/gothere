# ADR-0002: PostgreSQL, Drizzle ORM and the `pg` driver

Status: Accepted · 2026-11-27

## Context
Inventory correctness needs real transactions, row locks, check constraints and partial unique indexes. Deployment target is Vercel + Neon. Tests must exercise real concurrency.

## Decision
- PostgreSQL is the single source of truth (Postgres 17 locally via Docker, Neon in deployed environments).
- Drizzle ORM for typed queries and SQL migrations; migrations are generated, reviewed and committed; hand-written SQL uses custom migrations.
- `pg` (node-postgres) Pool through `drizzle-orm/node-postgres`, connecting to Neon's pooled endpoint. Interactive transactions work; Neon's HTTP driver does not support them.
- Explicit snake_case column names (no implicit casing) so SQL in constraints and migrations is predictable.

## Consequences
+ Database-enforced invariants (see `docs/invariants.md`).
+ Same driver locally, in CI and on Vercel.
− Connection count must be managed: small pool per instance (`DATABASE_POOL_MAX`), pooled endpoint. Revisit `@vercel/functions` pool attachment if connection churn appears.
