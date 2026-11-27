# Operations

## Environments

| `APP_ENV` | Where | Database | Notes |
| --- | --- | --- | --- |
| `local` | developer machine | Docker Postgres 17 `gothere` on `127.0.0.1:54329` | `pnpm db:up` |
| `test` | Vitest, CI | `gothere_test` (local) / service container (CI) | Reset by integration global setup; guard requires a local `*_test` DB |
| `preview` | Vercel preview deployments | Neon branch | Secure cookies; seeding allowed |
| `production` | Vercel production | Neon main branch | Scripts refuse to run without `ALLOW_PRODUCTION_SCRIPTS=true` |

## Configuration

Validated at first use by `src/infrastructure/env.ts` (Zod). Missing or invalid values fail fast with every problem listed. Documented in `.env.example`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_ENV` | default `local` | Safety guards and cookie security |
| `LOG_LEVEL` | default `info` | Structured logger threshold |
| `DATABASE_URL` | yes | Postgres connection (Neon: pooled URL, `sslmode=require`) |
| `DATABASE_POOL_MAX` | default 5 | Per-instance pool size; keep small on serverless |
| `BETTER_AUTH_SECRET` | yes, ≥ 32 chars | Session signing/encryption |
| `BETTER_AUTH_URL` | yes; https in production | Canonical origin; only trusted origin |
| `TEST_DATABASE_URL` | tests | Local `*_test` database |
| `PAYMENT_WEBHOOK_SECRET` | yes, ≥ 32 chars | HMAC key for provider (simulator) notifications |
| `CRON_SECRET` | for the job runner, ≥ 32 chars | Bearer secret for `/api/operations/run`; Vercel Cron sends it automatically when set under this name |
| `PAYMENT_SIMULATOR_SCENARIOS` | optional | `enabled`/`disabled`; default enabled for `local`/`test`, disabled elsewhere |
| `SEED_DEMO_PASSWORD`, `SEED_ADMIN_PASSWORD` | seeding | Demo account passwords (≥ 12 / ≥ 16 chars); admin only for local/test |
| `SEED_ALLOW_ADMIN` | optional | `true` to seed the admin account in preview (CTO decision) |

| `ANTHROPIC_API_KEY` | optional | Server-only provider key |
| `AI_MODEL_FAST` | optional | Runtime model id (Haiku-class); Opus rejected |
| `AI_MONTHLY_BUDGET_MINOR` | optional | Monthly AI ceiling in US cents; unset/0 = AI off |
| `AI_INPUT_MICRO_USD_PER_MTOK`, `AI_OUTPUT_MICRO_USD_PER_MTOK` | for unknown models | Prices; built in for `claude-haiku-5-5` and `claude-haiku-4-5` |
| `AI_TIMEOUT_MS` | default 12000 | Per-call timeout; a whole agent run gets twice this |

AI is enabled only when key, model, budget and a price are all known (`src/composition/ai.ts`); otherwise the
concierge answers with deterministic search, the organiser agent runs as a fixed automation through the same
governed actions, and briefs are rules text. The UI states which path answered. Spend is in `ai_usage_records`.

Introduced later: `SENTRY_DSN` (M4).

## Database

- Schema: `src/infrastructure/db/schema/*.ts`. Migrations: `drizzle/` (generated SQL, committed, never edited after being applied).
- Change flow: edit schema → `pnpm db:generate --name <change>` → review SQL → `pnpm db:migrate` locally → commit both. CI runs `drizzle-kit check`.
- Hand-written SQL (triggers, functions) goes in `drizzle-kit generate --custom` migrations.
- Neon provisioning (approved in principle; credentials not yet provided): one project, `main` branch for production, a branch per preview. Before any public deployment apply `scripts/sql/database-roles.sql`: `gothere_migrator` (owns schema, runs migrations) and `gothere_app` (DML only, cannot alter audit records). Migrations run from CI or a trusted machine, never at request time.

## Seed data

`pnpm db:seed` (idempotent, refuses production) creates the fictional ecosystem from `scripts/seed-data.ts`: demo users (2 attendees, 3 organizer members across 2 tenants, 1 platform admin in local/test only), 2 organizations, 6 published events with their experiences and inventory. Demo users are created through Better Auth so passwords are hashed exactly as in production.

Then `scripts/seed-history.ts` produces Halcyon Shore's sales history **through the real services** (`createReservation` → `startPayment` with the simulator): 240 synthetic buyers without credentials, 240 orders, every row stamped `origin = 'seed'`. Sunset Sessions ends at 150/150 (sold out) for the M3 unmet-demand workflow; Chef's Table at 36/40. Afterwards only timestamps are rewritten to spread history over the past ~12 weeks; counters, orders and tickets are exactly what the services produced. Re-running is a no-op. Anything created through the API is `origin = 'live'`.

`seedDemandSignals` adds the unmet-demand scenario (M3): after Sunset Sessions sold out, 384 distinct people still
wanted it (212 waitlist requests, 300 sold-out views, 128 both), plus three platform-level searches that found
nothing. Subject keys use the same keyed hash as live traffic (`BETTER_AUTH_SECRET`), so analysis treats them alike;
all rows are `origin = 'seed'`. Running the demand analysis on Tidal Assembly then proposes a second session: 150
places at EUR 35, EUR 5,250 maximum gross.

Demo walkthrough: sign in as the Tidal Assembly owner → `/organizer/intelligence` → *Run demand analysis* → *Let the
agent prepare it* → `/organizer/approvals` → *Approve and publish* → the session is on sale on the event page and
its live sales appear under the recommendation. The analyst account (Radu) can see everything but cannot act.

## Background jobs

Implemented in `src/modules/operations/jobs.ts` (design: [ADR-0007](adr/0007-durable-jobs-and-time.md), machine: [state-machines.md](state-machines.md#background-job)).

| Job type | Enqueued by | Does |
| --- | --- | --- |
| `payments.simulator.deliver` | simulator, per scenario | Signs and delivers a provider notification through the webhook path |
| `payments.reconcile_attempt` | payment start on timeout/ambiguous error | Asks the provider; retries with backoff while unresolved |
| `payments.simulated_refund` | acceptance policy (late/duplicate/mismatch) | Simulated refund at the provider, then `disposition = refunded` |

Each operations pass (`runOperationsCycle`) also sweeps overdue reservations and reconciles unprocessed provider events and stuck attempts. Triggers:

- **Vercel Cron**: `vercel.json`, daily at 04:00 UTC (Hobby-plan compatible). Set `CRON_SECRET` in Vercel.
- **Manual / demo**: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/operations/run`.
- **Opportunistic**: after a payment starts or a pending checkout is polled (`after()`), bounded to 10 jobs.

None of these is needed for correctness: expiry and acceptance decisions use the database clock in the transactional path.

## Incidents (M4)

Severity: P0 critical production/security · P1 major degradation · P2 limited issue · P3 minor. Severity never widens autonomous permissions. Incidents are deduplicated by fingerprint, carry correlation ids, technical and commercial impact, and a sanitized diagnostic report suitable for an external coding agent. Generated investigation packages are labelled distinctly from investigations actually executed.

## Observability

Structured JSON logs via `src/infrastructure/logging/logger.ts` with secret redaction. Every API request runs in a request context (`AsyncLocalStorage`) carrying a correlation id taken from a well-formed `x-request-id` or generated, echoed in the response, written into enqueued jobs and restored when they run. Sentry is introduced in M4.

## Frontend verification

- `pnpm test:e2e` builds nothing itself: run `pnpm build` first. Playwright starts `next start` on :3100 with `APP_ENV=test` (no auth rate limits, simulator scenarios on) and `DATABASE_POOL_MAX=10`, against the database in `DATABASE_URL` (seeded). Workers: 4 locally, 2 in CI.
- Journeys use test-only SQL for time travel (expiring a hold, making jobs due) via `tests/e2e/support.ts`.
- Accessibility: axe-core (WCAG 2.1 A/AA) on every attendee page; serious/critical violations fail.
- To mirror CI's data (integration-test fixtures, including events without images): `pnpm test:integration`, then `DATABASE_URL=<test url> APP_ENV=test pnpm db:seed`, then `DATABASE_URL=<test url> pnpm test:e2e`. The dev database alone can hide data-dependent failures.
- `CAPTURE=1` writes report screenshots to `docs/reports/m2/`; `METRICS=1` prints LCP, CLS and transfer sizes.
