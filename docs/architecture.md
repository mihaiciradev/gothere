# Architecture

A modular monolith on Next.js (App Router), PostgreSQL and Drizzle. Next.js is the delivery mechanism; the domain lives in plain TypeScript modules that UI, HTTP APIs and AI tools all call the same way.

## Layers

```text
src/
├── app/              Delivery: routes, layouts, route handlers. Thin: parse → call module → render.
│   └── api/_lib/     Route wrapper: correlation id, CSRF origin check, error mapping, rate limits.
├── composition/      Composition root: binds modules to configuration and job types (runtime.ts).
├── components/       Presentational UI. No data access.                                  (from M2)
├── modules/<name>/   Business capabilities.
│   ├── domain/       Pure rules and types. No I/O, no frameworks.
│   ├── *.ts          Application services: authorization, transactions, orchestration.
│   └── index.ts      The module's public API. The only file other code may import.
├── actions/          Business Action Registry: typed, permissioned, auditable actions, approvals. (M3)
├── ai/               AI Gateway and prompts. Calls actions, never the database.          (M3)
├── infrastructure/   Adapters: env, db (schema, client, migrations, error mapping), auth, logging, request context.
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
| `modules-not-presentation` | Modules, actions, ai, infrastructure and shared never import `app/`, `components/` or `composition/`. |
| `composition-uses-public-module-api` | The composition root imports module `index.ts` only. |
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
| `events` | M1 | Public catalogue; organizer event and experience management with lifecycle rules. | events, experiences |
| `inventory` | M1 | Availability (expiry-aware), `reserveUnits` / `releaseUnits` / `commitUnits`, organizer inventory updates. The only writer of counters. | inventory_items |
| `reservations` | M1 | Idempotent creation, per-user cap, expiry (exactly once), release, owner-only reads. | reservations, reservation_items |
| `payments` | M1 | Payment start, provider event recording and processing, acceptance policy, reconciliation, simulated refunds, provider simulator, webhook verification. | payment_attempts, payment_provider_events, simulator_payments (simulator only) |
| `ticketing` | M1 | Order confirmation and idempotent ticket issuance; owner-only order and ticket reads. | orders, tickets |
| `operations` | M1 | Durable job queue (claim, lease, fence, retry), database rate limiter, AI usage ledger with atomic budget reservations (M3). | jobs, api_rate_limits, ai_usage_records |
| `incidents` | M4 | Operational events (sanitized, append-only), deduplicated incidents, severity, technical and commercial impact, detectors, diagnostic reports, investigation packages, simulated scenarios, Control Center read models. See [ADR-0012](adr/0012-incident-detection.md). | operational_events, incidents, incident_timeline, investigation_packages |
| `analytics` | M3 | Demand signals (keyed-hash subjects), sales and per-item insights (live vs seed), deterministic unmet-demand analysis, recommendations, grounded briefs, outcome attribution. | demand_signals, commercial_recommendations |

Outside `modules/` (M3):

| Layer | Responsibility | Writes |
| --- | --- | --- |
| `actions/` | Business Action Registry, `invokeAction` executor, approval requests and decisions ([ai-actions.md](ai-actions.md), [ADR-0009](adr/0009-business-action-registry.md)). Calls module services only. | action_requests |
| `ai/` | AI Gateway (budget, timeouts, tool loop, usage), Anthropic adapter, concierge, organiser agent and briefs, deterministic intent parser ([ADR-0008](adr/0008-ai-gateway.md)). Uses actions as tools; never the database directly except the usage ledger via `operations`. | — |
| `composition/ai.ts` | Builds the gateway from env; AI off unless key, model, budget and price are set. | — |

Planned modules appear only when a milestone needs them; no empty folders.

## Domain model

```text
Organization ─┬─< OrganizationMembership >── User (platform_role)
              └─< Event ─┬─< Experience
                         └─< InventoryItem (admission | experience session)
User ─< Reservation ─< ReservationItem >── InventoryItem          (same event, enforced by composite FKs)
        Reservation ─< PaymentAttempt (status + disposition) ─< PaymentProviderEvent
        Reservation ── Order (1:1, paid by one accepted attempt of that reservation) ─< Ticket
                                       Ticket >── ReservationItem   (only reserved items can be ticketed)
AuditRecord (append-only, references by id only)   Job (durable queue)   SimulatorPayment (provider stand-in)
```

M3 adds, per tenant: DemandSignal (→ event, item; search signals are platform-level), CommercialRecommendation
(→ event, source item, created experience), ActionRequest (approval: params, hash, decision, outcome), and the
platform-level AiUsageRecord. Composite foreign keys pin demand signals and recommendations to their event's tenant.
M4 adds the platform-level Incident (one unresolved per fingerprint) with OperationalEvent (evidence), IncidentTimeline
and InvestigationPackage; ActionRequest gains a platform scope (no organization).

**Tenancy.** Every tenant-owned row carries `organization_id`. Child rows reference `(event_id, organization_id)` through a composite foreign key to `events(id, organization_id)`, so the database rejects a row whose tenant differs from its parent's. Attendee-owned rows (reservations, orders, tickets) also carry `user_id`; services filter by it. Below the event, composite keys chain every relationship: reservation lines share `event_id` with both their reservation and their inventory item; orders match their reservation on `(id, user_id, event_id)` and their payment attempt on `(id, reservation_id)`; tickets match their order on `(id, reservation_id, user_id, event_id)` and a reservation line on `(reservation_id, inventory_item_id)`. A cross-event or cross-tenant reference is a foreign-key violation.

**Inventory model.** One `inventory_items` row per sellable unit with `capacity`, `reserved`, `sold`. Availability is `capacity − reserved − sold`. Reservations increment `reserved` with a single guarded `UPDATE … WHERE capacity − reserved − sold >= :qty`; payment success moves units from `reserved` to `sold`; expiry or failure releases them. Check constraints make overselling and negative counters impossible even if a service is wrong. See [ADR-0004](adr/0004-inventory-counters.md).

**Lifecycles.** Reservation, payment and job machines are specified in [state-machines.md](state-machines.md).

| Entity | States |
| --- | --- |
| Event | draft → published → completed · cancelled |
| Experience | draft → published → archived (`origin`: manual or ai_recommendation) |
| InventoryItem | draft → on_sale ⇄ paused → closed |
| Reservation | active → converted · expired · released |
| PaymentAttempt.status | initiated → pending → succeeded · failed · unknown (→ reconciled) |
| PaymentAttempt.disposition | none → accepted · refund_required → refunded |
| Order | confirmed (refund states reserved for future organizer cancellations) |
| Ticket | valid → checked_in · void |

Late, duplicate or mismatched provider successes never create orders: the payment attempt is marked `refund_required` and refunded through the simulator. See [ADR-0006](adr/0006-payment-acceptance.md).

## Data conventions

- Money: integer minor units + ISO currency, `src/shared/money.ts`. Postgres `integer`; one order is far below 2³¹ cents.
- Time: `timestamptz` everywhere (UTC instants); events store an IANA `time_zone` for display.
- Ids: UUID v4 (`gen_random_uuid()`), including Better Auth tables.
- `origin` (`seed` | `live`) on reservations and orders separates seeded history from real activity in every analytic.
- Errors: `AppError` with a closed set of codes mapped to HTTP status; internals never leak (`toPublicError`).
- Time-dependent decisions (expiry) use the database clock (`now()`), never the application clock.
- Locks are always taken in the order: provider event → reservation → payment attempt → inventory rows by id.
- No transaction stays open across a provider call.
- HTTP contract: [api.md](api.md).

## Runtime

- Vercel (Node.js runtime, Fluid compute) + Neon PostgreSQL through its pooled connection string, `pg` Pool with a small `max`. See [ADR-0002](adr/0002-postgres-drizzle-pg.md).
- Better Auth for sessions (database-backed, HttpOnly cookies, origin checks, database-backed rate limiting). Tenancy and permissions are ours. See [ADR-0003](adr/0003-auth-and-tenancy.md).
- No in-memory transactional state; background work is durable rows in PostgreSQL claimed with leases (M1/M4, see [operations.md](operations.md#background-jobs)).

## Attendee interface (M2)

```text
src/app/(attendee)/
├── layout.tsx               header (session streamed behind Suspense), footer, MotionProvider, skip link
├── page.tsx                 /            featured event, ticker, event index, experiences rail, categories, concierge slot
├── discover/page.tsx        /discover    search + category/city/month filters (plain links), results
├── events/[slug]/           /events/:slug  hero, about, programme by day (event time zone), ticket panel (client)
├── checkout/[reservationId]/ /checkout/:id  server-loaded state, client state machine view, informational countdown
├── tickets/, tickets/[id]/  wallet and ticket pass (QR rendered on the server as an SVG data URI)
├── sign-in/, sign-up/       Better Auth email/password; `next` validated by safeRedirectPath
├── _components/, _lib/      route-level components (session-aware header, auth form, event index) and presenters
└── not-found.tsx, error.tsx designed 404 and error states
src/components/              presentational only: Photo + image loader, motion primitives, brand, header shell, tags
```

**Rendering.** `cacheComponents` is on: every page is a static shell (prerendered) with database and session reads streamed
behind `<Suspense>` after `await connection()`. Build output marks all attendee routes as Partial Prerender.

**Data flow.** Server components call module services directly (`listPublishedEvents`, `getPublishedEvent`,
`getReservationForOwner`, `listTicketsForUser`…) with the same owner checks as the API. Client components never touch the
database: mutations (reserve, pay, release) go through the existing API routes, so validation, CSRF, rate limiting and
idempotency are shared. Prices shown in the ticket panel are a preview; the reservation response is authoritative.

**Client JavaScript** is limited to: header shell (scroll state, mobile menu), event index hover preview, reveal/parallax
motion, ticket panel, checkout state view, auth form, sign-out. Everything else is server-rendered.

**Time.** All dates render in the event's IANA time zone. The checkout countdown starts from `secondsRemaining`, computed
by the database clock; the client only counts down from it and asks the server when it reaches zero.

**Next 16 behaviours handled.** Visited routes stay mounted in hidden `<Activity>` boundaries: components reset in-flight
state in effect cleanups, and the ticket panel is keyed by its carried selection. `usePathname` lives inside its own
Suspense boundary so dynamic routes keep a static shell.

**Motion.** Motion (`motion/react`) for reveal, parallax, hover preview and state transitions; transform/opacity only (CLS
measured at 0–0.002). `MotionConfig reducedMotion="user"` disables transform animation for reduced-motion users with
identical server/client markup. GSAP was not added: Motion covers the sequences needed, and a second animation runtime
would add weight without a visible gain.

**Imagery.** Unsplash URLs resized by their CDN via a custom `next/image` loader; sources in [assets.md](assets.md).

## Organizer interface (M3)

```text
src/app/organizer/
├── layout.tsx                 light "organizer" surface, section nav (keeps ?org=), skip link
├── page.tsx                   /organizer   live vs seeded revenue, opportunities, pending approvals, events table
├── events/[eventId]/          per-item inventory, sales (live/seed) and unmet demand; recommendation links
├── intelligence/              run analysis; recommendation cards: evidence, proposal, assumptions, risks, brief
│                              (rules or AI, numbers verified), delegate/dismiss, drafted state, actual outcome
├── approvals/                 inbox with exact params + hash, approve/reject, history, decision outcome banner
├── _lib/context.ts            actor + membership from the DB; ?org= only selects among the person's memberships
└── _components/               presentational primitives, client action buttons (call the API routes)
```

Attendee additions: the concierge (`_components/concierge.tsx`) on home and Discover, "Notify me" on sold-out items,
and demand beacons that report sold-out views and empty searches after the page is shown. All mutations go through
`/api/*`; pages read through the same permission-checked services.

## Control Center (M4)

```text
src/app/control/              platform admins only (role re-read from the DB on every page; others get not-found)
├── page.tsx                  /control   health tiles, open live incidents, simulated incidents (separate), audit trail
├── incidents/                list with filters; [incidentId]: impact, diagnosis, packages, approvals, timeline, evidence, status
├── transactions/             simulated payment attempts, decisions, refunds; live vs seed
└── ai/                       month-to-date spend vs budget, by feature and day, latest calls (no content)
src/app/api/control/          status, agent, platform actions, decisions (platform-only), simulations, package download
```

Detection hooks: `app/api/_lib/http.ts` (unhandled errors), `composition/runtime.ts` (stages, skipped holds,
detectors), `ai/gateway.ts` (provider failures, budget). Engineering agent: `ai/engineering-agent.ts`
([ADR-0013](adr/0013-governed-engineering-agents.md)). Access gate and CSP: `src/proxy.ts`, `next.config.ts`
([ADR-0011](adr/0011-pre-release-gate-and-csp.md)).

## Design system

Single source: `src/app/globals.css`. Brand primitives (`obsidian #101010`, `lime #E5FF54`, `offwhite #F5F5F0`, `violet #8264FF`) map to semantic surface tokens (`bg`, `raised`, `fg`, `muted`, `border`, `accent`, `accent-fg`) per interface via `data-surface="attendee|organizer|control"`. Typography: Space Grotesk (display), Geist (UI), Geist Mono (technical, `label` utility). Editorial primitives: `label`, `hairline`, `scrim-*`, `container-edge`, marquee. Violet marks intelligence features (concierge, living ticket, simulator); lime marks action and live state. Reduced motion is honoured globally.

Measured contrast (WCAG 2.x):

| Pair | Ratio | Use |
| --- | --- | --- |
| offwhite on obsidian | 17.4 | attendee body |
| lime on obsidian / obsidian on lime | 17.0 | accents, primary buttons |
| graphite-300 on obsidian | 9.3 | attendee muted text |
| violet on obsidian | 4.7 | non-text accents on dark (borders, markers) |
| violet-soft `#9A84FF` on graphite-900 / obsidian | 6.1 / 6.5 | violet **text** on dark (concierge, simulator, living ticket) |
| graphite-400 on obsidian | 5.6 | secondary labels on dark (graphite-500 is 2.9 — never for text on dark) |
| violet on offwhite | 3.7 | **large text / non-text only** |
| white on violet-strong `#6A4CF0` | 5.4 | organizer primary buttons |
| graphite-500 on offwhite | 6.0 | organizer muted text |
| graphite-400 on graphite-950 | 5.8 | control muted text |

## Scaling path

The production evolution for "100,000 arrivals in ten minutes" (≈167 arrivals/s average, with bursts far higher and several requests per arrival) is documented in M5 alongside measured k6 results. The prototype keeps the same seams: atomic DB reservations, idempotent payment handling, durable jobs, and a single place (`inventory`) where admission control and waiting-room tokens would plug in.
