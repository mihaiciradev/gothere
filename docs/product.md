# Product

gothere turns ticketing from a one-off transaction into a continuous relationship between organizers and their audiences. Festival-first, event-agnostic, multi-tenant.

## Pillars

| # | Pillar | Outcome |
| --- | --- | --- |
| 01 | Intent-driven discovery | Attendees describe interests, budget and constraints; AI recommends real events and experiences with live availability. |
| 02 | Resilient ticketing | Atomic reservations, transparent pricing, recoverable checkout, idempotent payments, clear transaction states. |
| 03 | Living tickets | A ticket becomes an event companion: schedule, bookable experiences, contextual help. |
| 04 | Unmet demand intelligence | Capture what people wanted and could not buy, and turn it into measurable opportunities. |
| 05 | Agentic organization | AI proposes and executes authorized business actions under deterministic permissions, risk policy and approvals. |
| 06 | Intelligent engineering operations | Detect failures, quantify commercial impact, prepare sanitized investigations for coding agents under control. |

## Signature capability: closed-loop intelligence

1. Attendees express intent (searches, waitlist requests, concierge conversations).
2. gothere records unmet demand as demand signals.
3. AI proposes an evidence-based opportunity (e.g. a second session of a sold-out experience).
4. An authorized organizer approves the exact, parameter-bound action.
5. The experience is published and purchasable.
6. Sales are attributed to the recommendation and reported as **actual** revenue, separate from the **estimated** opportunity.

Interest is never presented as guaranteed conversion. Every figure shown by AI must come from application data.

## Interfaces

| Interface | Routes | Character |
| --- | --- | --- |
| Attendee | `/`, `/discover`, `/events/[slug]`, `/checkout/[reservationId]`, `/tickets`, `/tickets/[id]` | Immersive, editorial, mobile-first checkout |
| Organizer | `/organizer`, `/organizer/events[/id]`, `/organizer/intelligence`, `/organizer/approvals` | Structured, commercial, AI embedded in workflows |
| Control Center | `/control`, `/control/incidents[/id]`, `/control/transactions`, `/control/ai` | Technical, precise; separates real telemetry from simulated scenarios |

Route-based separation in one deployment for the MVP. Subdomains (`organizer.gothere.ro`, `control.gothere.ro`, …) are a later routing change, not an architectural one.

## Scope

**P0 — essential**: attendee discovery, authentication and tenant isolation, transactional ticketing, recoverable simulated payment failures, availability-aware concierge, organizer intelligence dashboard, AI unmet-demand analysis, Business Action Registry, governed AI draft creation and publication, meaningful automated tests.

**P1 — desirable**: event companion, Control Center, incident detection with AI diagnosis, AI usage and cost visibility, controlled load test.

**P2 — optional**: real Cursor Cloud Agent investigation, external AI tool integration (MCP), advanced visual effects.

**Excluded**: real payments, Kubernetes, microservices, Kafka, vector databases without demonstrated need, LangChain-style orchestration, external ticketing integrations, production waiting-room infrastructure, unrestricted autonomous maintenance.

## Demonstration ecosystem

Fictional. Primary story: **Halcyon Shore 2027** by *Tidal Assembly* (Black Sea coast, four bookable experiences including the 150-seat *Sunset Sessions on the Pier*). Second tenant: *Northlight Live* with two events, used to demonstrate tenant isolation. Seed details: `scripts/seed-data.ts`; strategy: [operations.md](operations.md#seed-data).
