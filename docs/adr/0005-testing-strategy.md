# ADR-0005: Behavioural tests against real PostgreSQL

Status: Accepted · 2026-11-27

## Decision
- Vitest with two projects: `unit` (pure, no I/O) and `integration` (real PostgreSQL; the test database is dropped and migrated once per run; tests create uniquely named data and run files serially).
- The integration setup refuses any database that is not local and named `*_test`.
- Playwright for end-to-end journeys against a production build (desktop + mobile projects). k6 for load tests in M5.
- CI (GitHub Actions) runs typecheck, lint, boundaries, unit, integration (Postgres service container), migration drift check, build, e2e, and a production dependency audit.

## Consequences
+ Concurrency and constraint behaviour is tested where it actually lives.
− Integration tests need Docker locally (`pnpm db:up`).
