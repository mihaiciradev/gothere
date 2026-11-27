# Project state

Last updated: 2026-11-27 · Current milestone: **M1 complete — awaiting independent review**. Do not start M2 until the review is closed.

Review packages: [reports/m0-report.md](reports/m0-report.md) · [reports/m1-report.md](reports/m1-report.md).

## Milestones

| Milestone | Status |
| --- | --- |
| M0 Architecture and foundation | ✅ Done (conditionally approved) |
| M1 Transactional ticketing engine | ✅ Done (pending review) |
| M2 Attendee experience | ⏳ Next |
| M3 AI and organizer intelligence | — |
| M4 Engineering intelligence | — |
| M5 Verification and release | — |

## M1 delivered

- Catalogue and organizer management (`events`, `inventory`), atomic reservations (`reservations`), simulated payments with reconciliation and refunds (`payments`), orders and tickets (`ticketing`), durable jobs and rate limiting (`operations`), composition root.
- Review corrections: composite FKs across every transactional relationship; provider outcome vs acceptance split (ADR-0006); atomic per-user cap; idempotency bound to request hash; server-side prices; DB-clock expiry independent of jobs (ADR-0007); state-machine triggers; CSRF origin check; signed notifications; scenario gating; admin seeding guard; least-privilege role script.
- 16 HTTP endpoints ([api.md](api.md)) with correlation ids, strict validation, uniform errors.
- Service-driven seed: 240 historical orders (`origin = 'seed'`), Sunset Sessions sold out 150/150.
- Tests: 103 Vitest (23 unit, 80 integration on PostgreSQL) + 5 Playwright, including a purchase journey on the production build.

## Known limitations

- No UI beyond the holding page (M2). No sign-in screen; sessions via the auth API.
- Single currency per reservation; no service fees; no ticket transfer, check-in or QR (M2 companion).
- Organizer reads are minimal (event list with capacity/sold); analytics and demand signals are M3.
- Refunds and payments are simulated only; order-level refunds/cancellations are not implemented.
- Vercel Cron is daily; delayed notifications in a deployed demo advance via polling (`after()`) or the protected runner.
- Not deployed. Neon and Vercel approved in principle; credentials not provided.

## Next actions (M2 — attendee experience, after review)

1. Visual identity and layout system on the existing tokens; sign-in/sign-up screens on Better Auth.
2. `/` and `/discover`: editorial discovery over `listPublishedEvents`.
3. `/events/[slug]`: event page with live availability, experiences and sold-out states.
4. `/checkout/[reservationId]`: hold countdown, simulated payment (scenario picker only where enabled), pending/failed/expired states, polling.
5. `/tickets`, `/tickets/[id]`: digital tickets with code and QR.
6. Responsive and reduced-motion refinement; Playwright journeys for desktop and mobile.

## Open decisions for the CTO

See [reports/m1-report.md §12](reports/m1-report.md#12-decisions-requested): Neon/Vercel credentials, admin exposure on preview, simulator scenarios on the public demo, cron plan.
