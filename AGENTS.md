# AGENTS.md

Operating guide for any coding agent (Claude Code, Cursor, Codex) or engineer working in this repository.

## Read first

1. `docs/project-state.md` — current milestone, what is done, what is next. **Start here.**
2. `docs/architecture.md` — module map, dependency rules, domain model.
3. `docs/invariants.md` — rules that must never break. Any change touching inventory, reservations, payments, orders, tickets or approvals must keep these green.
4. `docs/security.md` — threat model and risk register.
5. `docs/adr/` — decisions already made. Do not silently reverse them; propose a new ADR.

## Commands

| Task | Command |
| --- | --- |
| Start local Postgres (Docker) | `pnpm db:up` |
| Apply migrations | `pnpm db:migrate` |
| Seed fictional demo data | `pnpm db:seed` |
| Dev server | `pnpm dev` |
| Fast gate (types, lint, boundaries, unit) | `pnpm check` |
| Integration tests (real Postgres, resets `*_test` DB) | `pnpm test:integration` |
| End-to-end tests | `pnpm build && pnpm test:e2e` |
| New migration after schema change | `pnpm db:generate --name <change>` |

Runtime: Node 24 (`.node-version`), pnpm via Corepack (`packageManager` in `package.json`).

## Rules

- Business logic lives in `src/modules/*`. Route handlers, server actions, React components and AI tools call module services; they never contain rules or raw SQL.
- Cross-module imports go through the module's `index.ts`. `pnpm boundaries` enforces this and the other dependency rules.
- Authorization is server-side, from the database, on every call (`requireOrganizationPermission`). Never trust tenant ids or roles from the client or from an AI model.
- Money is integer minor units plus currency (`src/shared/money.ts`). Never floats.
- Instants are UTC (`timestamptz`); presentation uses the event's IANA `time_zone`.
- No database transaction may stay open across a network call (payment provider, AI provider).
- Schema changes go through Drizzle migrations in `drizzle/`. Never edit an applied migration.
- Payments are simulated. The database rejects non-simulated payment attempts.
- Never commit secrets. `.env.local` is git-ignored; `.env.example` documents every variable.
- Never run migrations, seeds or destructive scripts against production. Scripts refuse `APP_ENV=production`.
- Prefer behavioural tests that would fail if an invariant broke. Concurrency tests use real PostgreSQL.
- Keep commits small, with short human-readable messages ("Add reservation lifecycle").

## Agent permissions

Agents may: read the repository, run local commands and tests, edit code on a branch, open pull requests.
Agents may not: push to `main`, merge, deploy, change secrets or environment variables, run against production data, spend paid credits (AI providers, Cursor Cloud Agents) without explicit human authorization, or approve their own changes.

## Updating context

When you finish a unit of work, update `docs/project-state.md` (status, next actions, known limitations). Record decisions with architectural, security or cost impact as a new ADR.
