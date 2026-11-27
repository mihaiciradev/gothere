# Architecture

A modular monolith on Next.js (App Router), PostgreSQL and Drizzle. Next.js is the delivery mechanism; the domain lives in plain TypeScript modules that UI, HTTP APIs and AI tools all call the same way.

## Layers

```text
src/
├── app/              Delivery: routes, layouts, route handlers, server actions. Thin: parse → call module → render.
├── components/       Presentational UI. No data access.                                  (from M2)
├── modules/<name>/   Business capabilities.
│   ├── domain/       Pure rules and types. No I/O, no frameworks.
│   ├── *.ts          Application services: authorization, transactions, orchestration.
│   └── index.ts      The module's public API. The only file other code may import.
├── actions/          Business Action Registry: typed, permissioned, auditable actions.  (M3)
├── ai/               AI Gateway and prompts. Calls actions, never the database.          (M3)
├── infrastructure/   Adapters: env, db (schema, client, migrations), auth, logging.
└── shared/           Dependency-free primitives: errors, money.
```

## Dependency rules

Enforced by `pnpm boundaries` (`.dependency-cruiser.cjs`); each rule has been verified to fail on a deliberate violation.

| Rule | Meaning |
| --- | --- |
| `no-circular` | No import cycles anywhere. |
| `domain-is-pure` / `domain-no-frameworks` | `modules/*/domain` imports only other domain code and `shared`; never Next, React, Drizzle, pg, Better Auth or AI SDKs. |
| `modules-public-api-only` | Cross-module imports only through `modules/<x>/index.ts`. |
| `app-uses-public-module-api` | Routes import module `index.ts` only. |
| `modules-not-presentation` | Modules, actions, ai, infrastructure and shared never import `app/` or `components/`. |
| `infrastructure-not-modules` | Adapters do not depend on business modules. |
| `components-no-server-internals` | UI cannot reach infrastructure, actions or ai. |
| `shared-is-leaf` | `shared` imports nothing internal. |

Schema tables live in `src/infrastructure/db/schema/` grouped by bounded context. Modules own the *behaviour* on those tables; a table is written by exactly one module (ownership column below).

## Modules

| Module | Status | Responsibility | Writes |
| --- | --- | --- | --- |
| `identity` | M0 | Resolve the authenticated `Actor` from the session; platform roles. | users (via Better Auth) |
| `organizations` | M0 | Memberships, role → permission policy, `requireOrganizationPermission`. | organizations, organization_memberships |
| `audit` | M0 | Append-only audit trail, written in the same transaction as the change. | audit_records |
| `events` | M1 | Event and experience catalogue, lifecycle, public read models. | events, experiences |
| `inventory` | M1 | Capacity, availability, atomic reserve/release/commit primitives. | inventory_items |
| `reservations` | M1 | Reservation lifecycle, expiry, hoarding limits. | reservations, reservation_items |
| `payments` | M1 | Payment simulator, attempts, provider events, reconciliation. | payment_attempts, payment_provider_events |
| `ticketing` | M1 | Order confirmation and idempotent ticket issuance. | orders, tickets |
| `analytics` | M3 | Sales and demand read models, demand signals. | demand_signals |
| `operations` | M4 | Durable jobs, incidents, AI usage records. | jobs, incidents, ai_usage |

Planned modules appear only when a milestone needs them; no empty folders.

## Domain model

```text
Organization ─┬─< OrganizationMembership >── User (platform_role)
              └─< Event ─┬─< Experience
                         └─< InventoryItem (admission | experience session)
User ─< Reservation ─< ReservationItem >── InventoryItem
        Reservation ─< PaymentAttempt ─< PaymentProviderEvent
        Reservation ── Order (1:1, on success) ─< Ticket
AuditRecord (append-only, references by id only)
```

Planned (M3–M4): DemandSignal, CommercialRecommendation, BusinessActionRequest, ActionApproval, Incident, Job, AiUsageRecord. Their contracts are in [ai-actions.md](ai-actions.md) and [operations.md](operations.md).

**Tenancy.** Every tenant-owned row carries `organization_id`. Child rows reference `(event_id, organization_id)` through a composite foreign key to `events(id, organization_id)`, so the database rejects a row whose tenant differs from its parent's. Attendee-owned rows (reservations, orders, tickets) also carry `user_id`; services filter by it.

**Inventory model.** One `inventory_items` row per sellable unit with `capacity`, `reserved`, `sold`. Availability is `capacity − reserved − sold`. Reservations increment `reserved` with a single guarded `UPDATE … WHERE capacity − reserved − sold >= :qty`; payment success moves units from `reserved` to `sold`; expiry or failure releases them. Check constraints make overselling and negative counters impossible even if a service is wrong. See [ADR-0004](adr/0004-inventory-counters.md).

**Lifecycles.**

| Entity | States |
| --- | --- |
| Event | draft → published → completed · cancelled |
| Experience | draft → published → archived (`origin`: manual or ai_recommendation) |
| InventoryItem | draft → on_sale ⇄ paused → closed |
| Reservation | active → converted · expired · released |
| PaymentAttempt | initiated → pending → succeeded · failed · unknown (→ reconciled) |
| Order | confirmed → refund_required → refunded |
| Ticket | valid → checked_in · void |

`refund_required` exists for a late payment success that arrives after the reservation expired and its inventory was resold: we never oversell to honour it; the order is flagged for (simulated) refund.

## Data conventions

- Money: integer minor units + ISO currency, `src/shared/money.ts`. Postgres `integer`; one order is far below 2³¹ cents.
- Time: `timestamptz` everywhere (UTC instants); events store an IANA `time_zone` for display.
- Ids: UUID v4 (`gen_random_uuid()`), including Better Auth tables.
- `origin` (`seed` | `live`) on reservations and orders separates seeded history from real activity in every analytic.
- Errors: `AppError` with a closed set of codes mapped to HTTP status; internals never leak (`toPublicError`).

## Runtime

- Vercel (Node.js runtime, Fluid compute) + Neon PostgreSQL through its pooled connection string, `pg` Pool with a small `max`. See [ADR-0002](adr/0002-postgres-drizzle-pg.md).
- Better Auth for sessions (database-backed, HttpOnly cookies, origin checks, database-backed rate limiting). Tenancy and permissions are ours. See [ADR-0003](adr/0003-auth-and-tenancy.md).
- No in-memory transactional state; background work is durable rows in PostgreSQL claimed with leases (M1/M4, see [operations.md](operations.md#background-jobs)).

## Design system

Single source: `src/app/globals.css`. Brand primitives (`obsidian #101010`, `lime #E5FF54`, `offwhite #F5F5F0`, `violet #8264FF`) map to semantic surface tokens (`bg`, `raised`, `fg`, `muted`, `border`, `accent`, `accent-fg`) per interface via `data-surface="attendee|organizer|control"`. Typography: Space Grotesk (display), Geist (UI), Geist Mono (technical). Reduced motion is honoured globally.

Measured contrast (WCAG 2.x):

| Pair | Ratio | Use |
| --- | --- | --- |
| offwhite on obsidian | 17.4 | attendee body |
| lime on obsidian / obsidian on lime | 17.0 | accents, primary buttons |
| graphite-300 on obsidian | 9.3 | attendee muted text |
| violet on obsidian | 4.7 | accents on dark (AA) |
| violet on offwhite | 3.7 | **large text / non-text only** |
| white on violet-strong `#6A4CF0` | 5.4 | organizer primary buttons |
| graphite-500 on offwhite | 6.0 | organizer muted text |
| graphite-400 on graphite-950 | 5.8 | control muted text |

## Scaling path

The production evolution for "100,000 arrivals in ten minutes" (≈167 arrivals/s average, with bursts far higher and several requests per arrival) is documented in M5 alongside measured k6 results. The prototype keeps the same seams: atomic DB reservations, idempotent payment handling, durable jobs, and a single place (`inventory`) where admission control and waiting-room tokens would plug in.
