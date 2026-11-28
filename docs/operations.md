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

## Runtime AI

- **Budget is a hard ceiling.** Before every provider call the gateway reserves the call's worst-case cost (request
  bytes + 2,048 tokens of framing at the input price, `max_tokens` at the output price) under a PostgreSQL advisory
  lock; if it does not fit in `AI_MONTHLY_BUDGET_MINOR`, no call is made and the feature falls back. The row is then
  settled to the real tokens and cost. Timeouts keep the reserved amount (the call may have been billed).
- **Ledgers are per database.** Local, test and Neon each count only their own `ai_usage_records`. Intended runtime
  ceiling: `AI_MONTHLY_BUDGET_MINOR=20` (US$0.20/month) on Vercel; local development is also set to 20.
- **Tests never call a provider.** Vitest and Playwright blank the AI variables; AI paths use a scripted provider.
- **Live spot-check (spends money, opt-in):** against a local seeded database only, with an explicit cap enforced by
  the same reservations: `DATABASE_URL=<local test db> pnpm ai:verify-live --max-usd=0.02`.

Live verification, 2026-11-28, `claude-haiku-5-5`, local test database (three runs, total cap US$0.02):

| Run | Concierge | Organiser agent | Brief | Calls | Input / output tokens | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | AI, 2 grounded picks | draft + publication pending approval (`ai_agent`, HIGH) | stored; amounts in cents (prompt fixed) | 9 | 18,210 / 2,871 | US$0.003262 |
| 2 | AI, no verifiable picks (fallback added) | draft + pending approval | rejected by number grounding (rules text kept) | 8 | 13,969 / 1,862 | US$0.002332 |
| 3 | AI, 1 grounded pick | draft + pending approval | stored, EUR amounts, grounded | 9 | 17,576 / 2,497 | US$0.003011 |
| **Total** | | | | **26** | **49,755 / 7,230** | **US$0.008605** |

Introduced later: `SENTRY_DSN` (M4).

## Database

- Schema: `src/infrastructure/db/schema/*.ts`. Migrations: `drizzle/` (generated SQL, committed, never edited after being applied).
- Change flow: edit schema → `pnpm db:generate --name <change>` → review SQL → `pnpm db:migrate` locally → commit both. CI runs `drizzle-kit check`.
- Hand-written SQL (triggers, functions) goes in `drizzle-kit generate --custom` migrations.
- Deployed databases (Neon): see [§ Neon setup](#neon-setup). Migrations run from CI or a trusted machine, never at request time.

## Neon setup

Rehearsed end to end on a Postgres 17 container mimicking Neon (non-superuser owner with CREATEROLE): roles SQL,
migrations as the migrator, seed as the runtime role, role check, and the full Playwright suite running as the
runtime role (42/42). The local Docker database is not involved.

| Role | Created by | Connection | Used for |
| --- | --- | --- | --- |
| `neondb_owner` (Neon default) | Neon | SQL Editor | Step 1 only (create the two roles). Never used by the app. |
| `gothere_migrator` | SQL, step 1 | **direct** (`ep-…`) | `pnpm db:migrate` from a trusted machine or CI. Owns every table. |
| `gothere_app` | SQL, step 1 | **pooled** (`ep-…-pooler`) on Vercel; direct for seeding | Runtime: DML only. No DDL, no TRUNCATE, cannot rewrite `audit_records` or delete `action_requests`. |

Create both roles **with SQL**: roles made in the Neon Console or API join `neon_superuser` (read/write on every
table). Pooled connections are PgBouncer in transaction mode; the app uses only transaction-scoped advisory locks
and protocol-level prepared statements, both supported. Startup parameters are not relied on through the pooler:
the statement timeout is set on the role. Use `sslmode=verify-full&channel_binding=require` in every URL.

1. **Roles** — Neon SQL Editor, database `neondb`, role `neondb_owner`: run `scripts/sql/database-roles.sql` with two
   generated passwords (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`). The
   final query must show `false` in every column.
2. **Local Neon env file** — copy `.env.neon.example` to `.env.neon` (git-ignored) and fill it in: migrator direct
   URL, app direct and pooled URLs, new `BETTER_AUTH_SECRET` and `PAYMENT_WEBHOOK_SECRET` (not the local ones),
   the planned `BETTER_AUTH_URL`, `SEED_DEMO_PASSWORD`.
3. **Migrate** — `pnpm db:migrate --env-file=.env.neon` (as `gothere_migrator`, direct; then re-grants `gothere_app`).
4. **Seed** — `pnpm db:seed --env-file=.env.neon` (as `gothere_app`; idempotent; no admin in `preview`).
5. **Verify** — `pnpm db:check-role --env-file=.env.neon` (direct and pooled; non-superuser, timeout set, data
   readable/writable, DDL/TRUNCATE/audit rewrite denied). Must print `Role check passed.`
6. **Vercel variables** — Production scope, mark secrets *Sensitive*: `DATABASE_URL` (app, **pooled**),
   `DATABASE_POOL_MAX=5`, `APP_ENV=preview`, `LOG_LEVEL=info`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
   `PAYMENT_WEBHOOK_SECRET`, `CRON_SECRET`, optionally `PAYMENT_SIMULATOR_SCENARIOS` and the AI variables. Never on
   Vercel: migrator credentials, `MIGRATION_DATABASE_URL`, `DATABASE_APP_ROLE`, `SEED_*`, `TEST_DATABASE_URL`.

Scripts load only the file named by `--env-file=` (never `.env.local` as well) and refuse a non-local database
unless its URL came from such a file. Every later migration: step 3 again. Local development is unchanged
(`pnpm db:migrate`, `pnpm db:seed` use `.env.local`).

**Status (2026-11-28):** Neon `neondb` (eu-central-1) migrated through `0008` as `gothere_migrator` over the direct
connection; seeded as `gothere_app` (5 demo users, 2 organizations, 6 events, 240 seeded orders, 593 demand signals,
no administrator); `pnpm db:check-role` passed on both the direct and the pooled connection (non-superuser, 10 s
statement timeout via the role, data read/write and transaction locks allowed, DDL / TRUNCATE / audit rewrites /
approval deletes denied). Neon AI ledger: empty.

## Vercel and domain

- The project is Git-connected: **every push to `main` deploys production** to https://gothere.mihaic.me (reads Neon).
- **Access gate (ADR-0011):** set `SITE_ACCESS_PASSWORD` (≥ 12 chars, Sensitive) in Vercel → Production. Without it the
  deployed site is closed except `/privacy`, the payment webhook and the cron endpoint. Share the password only with
  reviewers; rotate it to revoke every access cookie. Remove the gate after M5 with `SITE_ACCESS=open`.
  Env changes take effect on the next deployment (`pnpm dlx vercel@latest redeploy <url>` or a push).
- Verify the production variables without exposing them (values never printed; the pulled file is deleted):
  ```
  pnpm dlx vercel@latest login
  pnpm dlx vercel@latest link
  pnpm dlx vercel@latest env pull .env.vercel.production --environment=production --yes
  pnpm vercel:check-env .env.vercel.production --domain=https://gothere.mihaic.me
  ```
  Variables marked *Sensitive* cannot be pulled; the checker reports them as present-but-unreadable.
- Domain: `mihaic.me` uses Vercel DNS (`ns1/ns2.vercel-dns.com`), so `gothere.mihaic.me` needs no external DNS
  record. In the project: Settings → Domains → `gothere.mihaic.me` assigned to **Production**, status *Valid
  Configuration*, certificate issued. `BETTER_AUTH_URL` must equal `https://gothere.mihaic.me` exactly (no trailing
  slash): it is the only trusted origin for sign-in and CSRF checks. Other hostnames (the `*.vercel.app` URL) will
  serve pages but reject cookie-authenticated mutations, by design.

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

The pass is fault-isolated: sweep, reconciliation and job running are independent stages, and the sweep handles each
reservation separately. A row that would break an invariant (for example releasing units the counter does not hold)
is logged as `reservation expiry failed; skipped` and left untouched for investigation; it never blocks other
expiries, new reservations or payment jobs. `/api/operations/run` reports `failedStages`.

## Incidents (M4)

Severity: P0 critical production/security (set by people; no detector claims it) · P1 major degradation (purchase path,
payment or inventory integrity) · P2 limited issue · P3 minor (AI degradation). Severity only rises and never widens
any action's permissions. Design: [ADR-0012](adr/0012-incident-detection.md), [ADR-0013](adr/0013-governed-engineering-agents.md).

| Kind | Raised by | Severity | Commercial impact |
| --- | --- | --- | --- |
| `http.unhandled_error` | API route wrapper (500s) | P1 purchase path, else P2 | failed requests (not priced) |
| `operations.stage_failed` | maintenance pass | P1 payments/jobs, else P2 | delayed passes |
| `reservations.expiry_failed` | sweep skipped a hold | P1 | units and value held |
| `inventory.counter_mismatch` | detector | P1 | units and value at risk |
| `payments.unreconciled_success` | detector (10-minute grace) | P1 | amount charged without order or refund |
| `jobs.dead` | detector | P1 payment jobs, else P2 | amount of affected payments |
| `ai.provider_failure`, `ai.budget_exhausted` | AI gateway | P3 | none (fallbacks) |

Triage in the Control Center (`/control`, platform admins): acknowledge → run the engineering agent (AI diagnosis
with checked citations, or the runbook) → generate a package (a document only) → request an external investigation
(HIGH, always approved by a person) → resolve with a note. **No external agent is connected**: an approved dispatch
fails with "not executed" and the package stays "generated". Simulated scenarios (local/test/preview) create
labelled records only. The platform admin account is seeded only in local/test, so the deployed preview has no
Control Center user unless the CTO decides otherwise.

## Observability

Structured JSON logs via `src/infrastructure/logging/logger.ts` with secret redaction. Every API request runs in a request context (`AsyncLocalStorage`) carrying a correlation id taken from a well-formed `x-request-id` or generated, echoed in the response, written into enqueued jobs and restored when they run. Sentry is introduced in M4.

## Frontend verification

- `pnpm test:e2e` builds nothing itself: run `pnpm build` first. Playwright starts `next start` on :3100 with `APP_ENV=test` (no auth rate limits, simulator scenarios on) and `DATABASE_POOL_MAX=10`, against the database in `DATABASE_URL` (seeded). Workers: 4 locally, 2 in CI.
- Journeys use test-only SQL for time travel (expiring a hold, making jobs due) via `tests/e2e/support.ts`.
- Accessibility: axe-core (WCAG 2.1 A/AA) on every attendee page; serious/critical violations fail.
- To mirror CI's data (integration-test fixtures, including events without images): `pnpm test:integration`, then `DATABASE_URL=<test url> APP_ENV=test pnpm db:seed`, then `DATABASE_URL=<test url> pnpm test:e2e`. The dev database alone can hide data-dependent failures.
- `CAPTURE=1` writes report screenshots to `docs/reports/m2/`; `METRICS=1` prints LCP, CLS and transfer sizes.
