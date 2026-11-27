# ADR-0001: Modular monolith in one Next.js application

Status: Accepted · 2026-11-27

## Context
Three interfaces (attendee, organizer, control), one transactional core, 48-hour delivery, Vercel deployment, and a requirement that UIs, APIs and AI tools share the same business logic.

## Decision
One Next.js App Router application. Business logic in `src/modules/<capability>` with a pure `domain/` layer, application services, and a single public `index.ts`. Interfaces are route groups. Boundaries are enforced by dependency-cruiser in CI.

## Consequences
+ One deploy, one transaction boundary, no distributed consistency problems.
+ Modules can be extracted to services later along their `index.ts` seams if measurements justify it.
− Discipline relies on automated boundary checks; they are part of `pnpm check`.
Rejected: separate backend framework (NestJS/FastAPI), microservices — cost and latency without benefit at this scale.
