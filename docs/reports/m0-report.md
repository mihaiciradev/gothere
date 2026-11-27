# M0 implementation report — Architecture and foundation

| | |
| --- | --- |
| Milestone | M0 — Architecture and foundation |
| Status | Complete. **Awaiting independent architecture and security review.** M1 not started. |
| Baseline commit | `d29393c` "Initialize architecture" on `main` (github.com/mihaiciradev/gothere) |
| Report date | 2026-11-27 |
| Author | Claude (implementation engineer) |

Authoritative details live in the linked documents; this report summarizes them for review and adds the evidence (commands, results).

---

## 1. Implemented functionality

| Area | Delivered | Not delivered (by design) |
| --- | --- | --- |
| Toolchain | Node 24 pinned (`.node-version`, `engines`), pnpm 10.34.9 via Corepack, strict TypeScript, ESLint rules, `.gitattributes` (LF everywhere) | — |
| Architecture | Modular monolith layout, 9 enforced dependency rules, module public APIs | Empty placeholder modules |
| Configuration | Zod-validated server env with fail-fast aggregated errors; `.env.example` | Variables for M3/M4 (documented, not read) |
| Database | 17 tables, 13 enums, 2 migrations, DB-enforced invariants, local Docker Postgres 17, guarded migrate script | Services that mutate transactional tables (M1) |
| Authentication | Better Auth email/password, DB sessions, origin (CSRF) checks, DB-backed rate limiting, HTTP handler at `/api/auth/*` | Sign-in UI, email verification, social login |
| Authorization | `Actor` resolution, organization role → permission policy, `requireOrganizationPermission`, platform-admin check | Membership management UI/invitations |
| Audit | `recordAudit` (transactional), append-only table enforced by triggers | Audit viewer (M4) |
| Shared primitives | `AppError` with closed code set and safe public mapping; integer-minor-unit `Money`; structured JSON logger with redaction | Correlation-id middleware (M1) |
| Design system | Brand tokens, per-interface semantic surfaces (attendee/organizer/control), typography, reduced motion, measured contrast; holding page | Real screens (M2+) |
| Seed | Idempotent fictional ecosystem: 6 users, 2 organizations, 3 events, 5 experiences, 10 inventory items | Historical orders and demand signals (generated through M1/M3 services) |
| Testing | Vitest unit + real-Postgres integration projects, Playwright smoke (desktop + mobile) | k6 (M5) |
| CI | GitHub Actions: typecheck, lint, boundaries, unit, integration (Postgres service), migration drift check, build, e2e, production dependency audit | Deployment pipeline |
| Documentation | product, architecture, invariants, security, ai-actions, operations, project-state, 5 ADRs, AGENTS.md, CLAUDE.md, README | Vision and achievements one-pagers (challenge deliverables, later) |

## 2. Repository structure

```text
gothere/
├── .github/workflows/ci.yml      CI: verify job (all gates) + audit job
├── docker-compose.yml            Postgres 17 on 127.0.0.1:54329; init creates gothere_test
├── drizzle/                      Generated + custom SQL migrations (committed)
├── scripts/                      migrate.ts, seed.ts, seed-data.ts, lib/env.ts (production guard)
├── src/
│   ├── app/                      Next.js delivery: layout, holding page, /api/auth/[...all]
│   ├── infrastructure/
│   │   ├── auth/                 Better Auth factory (createAuth) + lazy singleton (getAuth)
│   │   ├── db/                   client (pg Pool + Drizzle), migrate, schema/{identity,organizations,catalog,commerce,audit}
│   │   ├── logging/              JSON logger with redaction
│   │   └── env.ts                Zod env validation
│   ├── modules/
│   │   ├── identity/             domain/actor.ts, session.ts (getActor, requireActor, requirePlatformAdmin)
│   │   ├── organizations/        domain/permissions.ts, authorization.ts (requireOrganizationPermission)
│   │   └── audit/                recordAudit
│   └── shared/                   errors.ts, money.ts
├── tests/{unit,integration,e2e}/
├── docs/{product,architecture,invariants,security,ai-actions,operations,project-state}.md, adr/, reports/
├── AGENTS.md, CLAUDE.md, README.md, .env.example, .gitattributes
└── .dependency-cruiser.cjs, drizzle.config.ts, vitest.config.ts, playwright.config.ts
```

### Dependency rules (enforced by `pnpm boundaries`, each verified to fail on a deliberate violation)

`no-circular` · `domain-is-pure` · `domain-no-frameworks` (no Next/React/Drizzle/pg/Better Auth/AI SDK in `domain/`) · `modules-public-api-only` · `app-uses-public-module-api` · `modules-not-presentation` · `infrastructure-not-modules` · `components-no-server-internals` · `shared-is-leaf`.

## 3. Architectural decisions and trade-offs

| ADR | Decision | Trade-off accepted |
| --- | --- | --- |
| [0001](../adr/0001-modular-monolith.md) | One Next.js app; domain in modules with public `index.ts` | Boundary discipline depends on CI checks (in place) |
| [0002](../adr/0002-postgres-drizzle-pg.md) | PostgreSQL as single source of truth; Drizzle with explicit column names; `pg` Pool against Neon's pooled endpoint | Must manage connections on serverless (small pool, pooled endpoint). Neon HTTP driver rejected: no interactive transactions |
| [0003](../adr/0003-auth-and-tenancy.md) | Better Auth for sessions; tenancy and permissions in our own module | We own membership management; avoids plugin semantics leaking into the AI action registry |
| [0004](../adr/0004-inventory-counters.md) | Inventory as `capacity/reserved/sold` counters mutated by guarded single-statement updates, backed by check constraints | A single hot item serializes on one row; production mitigation is admission control/waiting room (M5 plan) |
| [0005](../adr/0005-testing-strategy.md) | Behavioural tests against real PostgreSQL; e2e against production build | Integration tests need Docker locally |

Other reversible decisions taken without escalation:
- UUID ids everywhere, including Better Auth tables (`generateId: "uuid"`).
- The transactional schema (reservations → tickets) was designed and migrated in M0 so invariants are reviewable now; the services come in M1. AI/ops tables (demand signals, recommendations, action requests, approvals, incidents, jobs, AI usage) are designed in docs only.
- Packages for later milestones (Anthropic SDK, Sentry, Motion, GSAP, Radix, Recharts) not installed yet.
- `violet-strong #6A4CF0` added because white on brand violet `#8264FF` is 4.03:1 (fails AA); brand violet is kept for large text, dark-surface accents and non-text use.

## 4. Database schema and relationships

PostgreSQL 17 locally; migrations `0000_initial_schema.sql` (tables, enums, constraints) and `0001_audit_append_only.sql` (triggers).

```text
organizations ─┬─< organization_memberships >── users (platform_role)
               └─< events ─┬─< experiences
                           └─< inventory_items ── (experience_id → experiences, kind = experience)
users ─< reservations ─< reservation_items >── inventory_items
         reservations ─< payment_attempts ─< payment_provider_events
         reservations ── orders (1:1) ─< tickets >── inventory_items
audit_records (append-only; ids stored as values, not FKs)
users ─< sessions, accounts      verifications, rate_limits (Better Auth)
```

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `users` | Accounts (Better Auth) | unique email; `platform_role` enum default `attendee` |
| `sessions`, `accounts`, `verifications`, `rate_limits` | Better Auth storage | unique session token; unique rate-limit key; cascades from users |
| `organizations` | Tenants | unique slug, slug format check |
| `organization_memberships` | User ↔ tenant with role (`owner`, `manager`, `analyst`) | unique (organization, user) |
| `events` | Tenant-owned events, IANA `time_zone`, UTC instants | unique slug; unique (id, organization_id) for composite FKs; `ends_at > starts_at` |
| `experiences` | Bookable sessions within an event; `origin` manual / ai_recommendation | composite FK (event_id, organization_id) → events; unique (event, slug); publish-state consistency check |
| `inventory_items` | Sellable capacity: admission or experience session | composite tenant FK; FK (experience_id, event_id) → experiences; `reserved + sold ≤ capacity`; non-negative counters and price; currency format; `max_per_order` 1–20; kind ↔ experience consistency; sales window order |
| `reservations` | Attendee hold with expiry; `origin` seed/live | composite tenant FK; unique (user, idempotency_key); index (status, expires_at) |
| `reservation_items` | Lines | unique (reservation, item); quantity > 0 |
| `payment_attempts` | Simulated payment attempts | unique (reservation, idempotency_key); partial unique: one `succeeded` per reservation; `simulated = true` check; unique provider reference |
| `payment_provider_events` | Inbound notifications | unique (provider, provider_event_id) — deduplication |
| `orders` | Confirmed purchase | unique reservation; unique payment attempt; composite tenant FK; status includes `refund_required` for late success after resale |
| `tickets` | Issued tickets | unique (order, item, ordinal) — idempotent issuance; unique code; composite tenant FK |
| `audit_records` | Audit trail | `UPDATE`/`DELETE`/`TRUNCATE` rejected by triggers |

Conventions: money in integer minor units with explicit currency; `timestamptz` (UTC) with event time zones for display; `origin` separates seeded history from live activity. Full invariant catalogue with status: [invariants.md](../invariants.md).

## 5. Authentication and tenant isolation

**Authentication** (`src/infrastructure/auth/auth.ts`)
- Email + password; scrypt hashing (Better Auth default); password length 12–128.
- Database-backed sessions: 7-day expiry, refreshed daily; no cookie cache, so revocation is immediate.
- Cookies `gothere.*`: HttpOnly and SameSite=Lax (asserted in tests), Secure in preview/production.
- CSRF: origin validation on state-changing requests; trusted origin is `BETTER_AUTH_URL` only.
- Rate limits stored in PostgreSQL (valid across serverless instances): sign-in 5/min, sign-up 3/min, other auth routes 100/min per IP.
- `platformRole` is an additional field with `input: false`: clients cannot set it.

**Actor resolution** — `identity.getActor(headers)` derives `{ userId, email, platformRole }` from the server-side session only.

**Tenant isolation, three layers**
1. **Policy** — `organizations/domain/permissions.ts`: pure role → permission map. Owner: all; manager: catalogue, inventory, publish, approve; analyst: read-only.
2. **Gate** — `requireOrganizationPermission(db, actor, organizationId, permission)` reads the membership from the database on every call. Non-member → `NOT_FOUND` (does not reveal the tenant exists). Member without permission → `FORBIDDEN`. Platform admins get no implicit tenant access.
3. **Database** — composite foreign keys to `events(id, organization_id)` on experiences, inventory, reservations, orders and tickets, so a row can never belong to a different tenant than its event.

Attendee-owned data (reservations, orders, tickets) is scoped by `user_id`; the services that enforce this arrive in M1 (TKT-2).

## 6. Security controls and outstanding risks

Controls in place: see [security.md](../security.md#controls-in-place-m0). Highlights verified at runtime on a production build:

| Check | Result |
| --- | --- |
| Cross-origin `POST /api/auth/sign-in/email` | `403 INVALID_ORIGIN` |
| 7 rapid wrong-password attempts | `401 ×3`, then `429 ×4` |
| Sign-up with `platformRole: "platform_admin"` | User created as `attendee` |
| Response headers | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `COOP`; no `X-Powered-By` |
| Non-simulated payment insert | Rejected by `payment_attempts_simulated_only` |
| Audit update/delete | Rejected by trigger |

Outstanding risks (full register: [security.md](../security.md#risk-register)):

| ID | Risk | Severity | Plan |
| --- | --- | --- | --- |
| R-03 | Reservation hoarding / bots | High | M1: per-user active cap, `max_per_order`, short expiry, rate limits |
| R-04 | Prompt injection | High | M3: content delimited as data, registry-only tools, approvals |
| R-05 | Approval tampering / replay | High | M3: parameter hash, single-use, expiry, re-authorization |
| R-11 | Admin demo credentials exposure | High if leaked | CTO decision; recommend no admin login on public demo |
| R-01 | No email verification | Medium | Accepted for prototype |
| R-02 | No CSP | Medium | M5, nonce-based |
| R-06 | AI cost runaway | Medium | M3 budgets and usage records |
| R-10 | Runtime DB role with DDL rights | Medium | Separate migrator/app roles on Neon before public deploy |
| R-07, R-08, R-09 | Session token readable via same-origin `get-session`; IP-based rate-limit key; moderate esbuild advisory (dev server only) | Low | Tracked |

No Critical findings. Unmitigated High items are all for features not built yet; none blocks M1. They block **public deployment** until addressed.

## 7. Installed dependencies

Runtime:

| Package | Version | Purpose |
| --- | --- | --- |
| next | 16.4.6 | Framework (pre-existing) |
| react / react-dom | 19.3.0 | UI (pre-existing) |
| drizzle-orm | 0.45.4 | Query builder, migrations runtime |
| pg | 8.23.1 | PostgreSQL driver |
| better-auth | 1.7.28 | Authentication |
| zod | 4.6.7 | Validation |

Development:

| Package | Version | Purpose |
| --- | --- | --- |
| typescript | 5.9.3 | Pre-existing (TS 7 deliberately not adopted yet) |
| tailwindcss / @tailwindcss/turbopack | 4.3.3 | Pre-existing |
| eslint / eslint-config-next | 9.39.5 / 16.4.6 | Pre-existing |
| drizzle-kit | 0.31.11 | Migration generation and drift check |
| vitest | 5.1.2 | Unit and integration tests |
| @playwright/test | 1.65.1 | End-to-end tests |
| dependency-cruiser | 18.9.0 | Architecture boundaries |
| tsx | 4.23.15 | Running TypeScript scripts |
| @types/node / @types/pg / @types/react / @types/react-dom | 24.19.4 / 8.23.1 / 19.3.3 / 19.3.0 | Types |

Install scripts allowed: `esbuild` only (`pnpm-workspace.yaml`). `pnpm audit --prod`: 0 critical, 0 high, 1 moderate (R-09).

## 8. Tests executed and actual results

Local run on 2026-11-27, Windows 11, Node 24.22.3, PostgreSQL 17 (Docker):

| Gate | Command | Result |
| --- | --- | --- |
| Types | `pnpm typecheck` | Pass |
| Lint | `pnpm lint` | Pass |
| Boundaries | `pnpm boundaries` | Pass — 0 violations (36 modules, 53 dependencies) |
| Migration drift | `pnpm drizzle-kit check` | Pass |
| Unit | `vitest --project unit` | **12 / 12 passed** (4 files) |
| Integration | `vitest --project integration` | **17 / 17 passed** (3 files, real PostgreSQL) |
| Build | `pnpm build` | Pass |
| End-to-end | `pnpm test:e2e` | **4 / 4 passed** (desktop + mobile) |
| Audit | `pnpm audit --prod` | 1 moderate, 0 high/critical |

Integration tests, by behaviour:

| Suite | Tests |
| --- | --- |
| Inventory invariants | overflow and negative counters rejected · 40 concurrent guarded reservations on capacity 10 → exactly 10 succeed · 20 concurrent unguarded increments on capacity 5 → exactly 5 succeed, the check constraint stops the rest |
| Tenant consistency | experience with another tenant's event rejected · inventory with another tenant's event rejected |
| Payments and tickets | non-simulated payment rejected · second successful payment for the same reservation rejected · second order for the same reservation rejected · duplicate ticket ordinal rejected |
| Audit | update and delete rejected |
| Organization authorization | owner granted · analyst denied `experience.publish` (`FORBIDDEN`) · cross-tenant → `NOT_FOUND` · platform admin without membership → `NOT_FOUND` |
| Authentication | client-supplied `platform_admin` role ignored · HttpOnly + SameSite=Lax cookie issued and session resolved · wrong password and unknown user return identical 401 codes · short password rejected |

**CI** (GitHub Actions run 46026051543 on `d29393c`):
- `verify` job: **success** — every step green, including integration tests on the Postgres service, the drift check, build, Playwright install and e2e.
- `audit` job: the audit step itself **passed**, but the job was marked **failed** by the post-step of `actions/setup-node@v5`. setup-node v5 enables pnpm caching automatically when `packageManager` is set, and this job never installs, so there was no store to save. Fixed in the working tree with `package-manager-cache: false`; confirmed only once the next run is green.

Mandatory M1–M3 scenarios (duplicate payment events, failed payment recovery, expiry release, delayed confirmation, unauthorized/approval AI actions, AI outage) are **not yet tested** because the services don't exist; the database-level guarantees they rely on are.

## 9. Environment variables and external services

| Variable | Required now | Notes |
| --- | --- | --- |
| `APP_ENV` | default `local` | `local` · `test` · `preview` · `production`; drives guards and secure cookies |
| `LOG_LEVEL` | default `info` | |
| `DATABASE_URL` | **yes** | Neon pooled URL with `sslmode=require` when deployed |
| `DATABASE_POOL_MAX` | default 5 | |
| `BETTER_AUTH_SECRET` | **yes**, ≥ 32 chars | Unique per environment |
| `BETTER_AUTH_URL` | **yes**; https in production | Canonical origin |
| `TEST_DATABASE_URL` | tests | Must be local `*_test` |
| `SEED_DEMO_PASSWORD` / `SEED_ADMIN_PASSWORD` | seeding | ≥ 12 / ≥ 16 chars |
| `ANTHROPIC_API_KEY`, `AI_MODEL_FAST`, `AI_MONTHLY_BUDGET_MINOR` | M3 | Server-only |
| `OPERATIONS_SECRET` | M1 | Protects job runner and cron endpoints |
| `SENTRY_DSN` | M4 | |

| External service | State | Needed for |
| --- | --- | --- |
| GitHub repository | **Connected** (`mihaiciradev/gothere`), CI running | — |
| Docker (local Postgres) | Running locally | Development and integration tests |
| Neon PostgreSQL | **Not provisioned** | Preview/production |
| Vercel | **Not configured** | Deployment, cron |
| Anthropic API | **Not configured** | M3 AI Gateway |
| Sentry | Not configured | M4 (optional) |
| Cursor Cloud Agents | Not configured | P2, explicit authorization only |

No credentials were invented; no external service is claimed as connected beyond GitHub.

## 10. Known limitations and incomplete functionality

- Holding page only; no attendee, organizer or Control Center screens; no sign-in UI.
- No domain services for events, inventory, reservations, payments, orders or tickets — schema and DB invariants only.
- No correlation ids, route-level Zod validation pattern, or HTTP error mapping helper yet (types exist: `AppError.httpStatus`, `toPublicError`).
- No background jobs table/runner yet (designed in [operations.md](../operations.md#background-jobs)).
- Business Action Registry, AI Gateway, demand signals, incidents: design only.
- No email verification, no CSP, no Sentry.
- Seed creates catalogue and accounts only. Sold-out and unmet-demand states come from M1/M3 service-driven seeding, never from writing counters directly.
- Not deployed. A Windows-specific local path is kept out of the repo (`.claude/launch.json` git-ignored).
- The CI audit-job fix is unverified until the next push.

## 11. Proposed M1 scope — Transactional core

Goal: a complete, provably correct purchase lifecycle with simulated payments, no UI beyond what tests need.

1. **events** — published catalogue read models (events, experiences, live availability); organizer create/update behind `event.write` / `experience.write`; audit on writes.
2. **inventory** — `reserve`, `release`, `commit` primitives (ADR-0004), the only code that mutates counters.
3. **reservations** — idempotent create (`user + idempotency_key`), expiry (lazy on read + job), per-user active cap, `max_per_order`, ownership checks.
4. **payments** — simulator with scenarios (success, failure, delayed, duplicate notification, success after expiry, provider unavailable), clearly labelled as simulated; attempts with idempotency; provider-event deduplication; reconciliation of `unknown`/late outcomes; no transaction held across provider calls.
5. **ticketing** — order confirmation + `reserved → sold` + idempotent ticket issuance in one transaction; `refund_required` path for late success when inventory is gone.
6. **operations (jobs)** — `jobs` table, `FOR UPDATE SKIP LOCKED` claiming, leases, retries with backoff; protected manual runner (`OPERATIONS_SECRET`); Vercel Cron wiring documented.
7. **HTTP layer** — correlation ids, Zod-validated route handlers, `AppError` → HTTP mapping, rate limits on reservation and payment endpoints.
8. **Tests** — every mandatory transactional scenario: concurrent oversell, duplicate payment events, failed payment recovery, expiry release, delayed confirmation, expiry vs confirmation race, late success, cross-user access.
9. **Seed** — historical orders through the services (`origin = 'seed'`), producing the sold-out *Sunset Sessions* state.

Exit criteria: all invariants in [invariants.md](../invariants.md) marked ⏳ M1 become ✅ with named tests; CI green.

## 12. Decisions requested from the human CTO

1. Approve Neon project creation (free tier) with separate migrator and runtime roles.
2. Approve Vercel project setup (no public deployment until the High risks for shipped features are closed).
3. Provide Anthropic API access, confirm the Haiku model id available to the account, and set a monthly AI budget (needed by M3).
4. Decide whether the platform-admin demo login is reachable on any public deployment (recommendation: no).
5. Close the M0 architecture and security review, then authorize M1.
