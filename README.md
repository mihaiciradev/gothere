# gothere

**The next generation of live experiences.**

An AI-native event and ticketing platform prototype built for the EPS CTO challenge. Festival-first, event-agnostic. It connects attendees, organizers and engineering operations through one transactional core and one governed intelligence layer.

> Prototype. All events, organizations, people and payments are fictional. No real money is processed.

## What's inside

- **Attendee platform**: intent-driven discovery, resilient checkout, living tickets.
- **Organizer platform**: sales analytics, unmet-demand intelligence, governed AI recommendations with approvals.
- **Control Center**: incidents, transactions, AI usage and audit visibility.

All three are route groups of one Next.js application on a modular monolith. See [docs/product.md](docs/product.md) and [docs/architecture.md](docs/architecture.md).

## Quick start

Requirements: Node 24, Docker (for local PostgreSQL). pnpm comes from Corepack.

```bash
corepack enable
pnpm install
cp .env.example .env.local      # then fill BETTER_AUTH_SECRET and the SEED_* passwords
pnpm db:up                      # PostgreSQL 17 on 127.0.0.1:54329 (dev + _test databases)
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Quality gates

```bash
pnpm check              # typecheck, lint, dependency boundaries, unit tests
pnpm test:integration   # real PostgreSQL: invariants, concurrency, tenancy, auth
pnpm build && pnpm test:e2e
```

CI runs all of the above on every push and pull request (`.github/workflows/ci.yml`).

## Documentation

| Document | Purpose |
| --- | --- |
| [docs/project-state.md](docs/project-state.md) | Milestone status and next actions |
| [docs/reports/](docs/reports/) | Milestone implementation reports |
| [docs/product.md](docs/product.md) | Product pillars and scope |
| [docs/architecture.md](docs/architecture.md) | Modules, boundaries, domain model, design system |
| [docs/invariants.md](docs/invariants.md) | Business invariants and how each is enforced |
| [docs/state-machines.md](docs/state-machines.md) | Reservation, payment and job state machines |
| [docs/api.md](docs/api.md) | HTTP API |
| [docs/security.md](docs/security.md) | Threat model and risk register |
| [docs/ai-actions.md](docs/ai-actions.md) | Business Action Registry and approvals |
| [docs/operations.md](docs/operations.md) | Environments, configuration, migrations, jobs |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [AGENTS.md](AGENTS.md) | Working rules for humans and coding agents |
