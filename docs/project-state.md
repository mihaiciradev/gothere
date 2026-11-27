# Project state

Last updated: 2026-11-27 · Current milestone: **M0 complete — awaiting architecture and security review**. Do not start M1 until the review is closed.

## Milestones

| Milestone | Status |
| --- | --- |
| M0 Architecture and foundation | ✅ Done (pending review) |
| M1 Transactional core | ⏳ Next |
| M2 Attendee experience | — |
| M3 AI and organizer intelligence | — |
| M4 Engineering intelligence | — |
| M5 Verification and release | — |

## M0 delivered

- Toolchain: Node 24 (`.node-version`, `engines`), pnpm 10.34.9 via Corepack, strict TypeScript (`noUncheckedIndexedAccess`), ESLint (no `any`, type-only imports, no stray `console`).
- Architecture: module layout and dependency rules enforced by dependency-cruiser (`pnpm boundaries`), each rule proven against a deliberate violation.
- Environment: Zod-validated server env (`src/infrastructure/env.ts`), `.env.example`.
- Database: Drizzle schema for identity, tenancy, catalogue, inventory, reservations, payments, orders, tickets and audit; 2 migrations (initial schema; append-only audit triggers); Docker Postgres 17 with dev and test databases; production-guarded migrate and seed scripts.
- Authentication: Better Auth (email/password, DB sessions, origin checks, DB-backed rate limits, role field not client-settable); `identity` module resolves the `Actor`; `organizations` module provides role policy and `requireOrganizationPermission`; `audit` module.
- Design tokens: brand primitives, per-interface semantic surfaces, typography, reduced motion; AA contrast measured. Holding page only.
- Seed: fictional ecosystem (6 users, 2 tenants, 3 events, 5 experiences, 10 inventory items), idempotent.
- Tests: 4 unit files, 3 integration files (real Postgres), Playwright smoke (desktop + mobile). CI workflow for all gates plus dependency audit.
- Docs: product, architecture, invariants, security (threat model + risk register), ai-actions (registry design), operations, 5 ADRs, AGENTS.md, CLAUDE.md.

## Known limitations

- No UI beyond a holding page; no sign-in screen yet (auth is exercised via API and tests).
- No email verification (R-01). No CSP (R-02).
- Services for reservations, payments, orders and tickets do not exist yet; only their schema and DB-level invariants.
- Sentry, AI Gateway, Anthropic SDK, Motion/GSAP/Radix/Recharts not installed yet — added in the milestone that first uses them.
- Not deployed. No Neon project, Vercel project or GitHub remote configured.

## Next actions (M1 — transactional core)

1. `events` module: public catalogue read models (published events, experiences, availability) and organizer CRUD behind permissions.
2. `inventory` module: `reserve`, `release`, `commit` primitives (ADR-0004).
3. `reservations` module: create (idempotent), expiry (lazy on read + job), per-user active cap, ownership checks.
4. `payments` module: simulator with scenarios (success, failure, delayed, duplicate notification, success after expiry, provider unavailable), attempts, provider events, reconciliation.
5. `ticketing` module: order confirmation + idempotent ticket issuance in one transaction.
6. Durable `jobs` table and protected runner for expiry and reconciliation.
7. Correlation ids, Zod-validated route handlers, `AppError` → HTTP mapping.
8. Tests for every mandatory scenario in the brief (concurrency, duplicates, failures, expiry, late success, cross-user access).
9. M1 seed: historical orders via services (`origin = 'seed'`), sold-out Sunset Sessions.

## Open decisions for the CTO

See the M0 report: GitHub repository and remote, Neon project, Vercel project, Anthropic API access and budget, admin demo exposure.
