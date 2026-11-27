# Project state

Last updated: 2026-11-28 · Current milestone: **M3 complete — awaiting independent review**. Do not start M4 until the review is closed.

Review packages: [reports/m0-report.md](reports/m0-report.md) · [reports/m1-report.md](reports/m1-report.md) · [reports/m2-report.md](reports/m2-report.md) · [reports/m3-report.md](reports/m3-report.md).

## Milestones

| Milestone | Status |
| --- | --- |
| M0 Architecture and foundation | ✅ Done (conditionally approved) |
| M1 Transactional ticketing engine | ✅ Done (conditionally approved) |
| M2 Attendee experience | ✅ Done |
| M3 AI and organizer intelligence | ✅ Done (pending review) |
| M4 Engineering intelligence | ⏳ Next |
| M5 Verification and release | — |

## M3 delivered

- Demand signals (waitlist, sold-out views, unmatched searches) with keyed-hash subjects; seeded Sunset Sessions scenario (384 interested).
- Organizer interface: overview, event insights, intelligence (recommendations with evidence, proposal, assumptions, risks, outcome), approvals.
- Deterministic unmet-demand analysis; grounded briefs; outcome attribution from live orders.
- Business Action Registry with one executor for UI, API and AI; parameter-bound, single-use, expiring approvals (trigger-guarded).
- AI Gateway (Anthropic adapter, budget, timeouts, usage ledger), concierge and organiser agent, each with a deterministic fallback.
- Quality: 166 Vitest tests (40 unit, 126 integration), 42 Playwright tests on desktop and mobile including axe.

## Known limitations

- Runtime AI is not connected (no credentials); fallbacks are live and labelled. See the M3 report §9.
- No Control Center UI yet (M4). Living ticket is a placeholder.
- Waitlist does not send notifications (no email provider).
- Organizer screens cover intelligence and approvals; event and inventory editing are API-only.
- Imagery is hotlinked from Unsplash (R-17). No CSP yet (R-02, M5).
- No email verification, password reset or social sign-in. QR codes are display-only.
- Not deployed.

## Next actions (M4 — engineering intelligence, after review)

1. Structured operational events and incident records (fingerprint dedupe, severity P0–P3, correlation ids, technical and commercial impact).
2. Control Center (`/control`): health, incidents and timeline, transactions, AI usage and cost (`ai_usage_records` exists), audit.
3. Sanitized diagnostic reports and AI-assisted analysis through a registered `incident.investigate` action (approval always).
4. Optional external agent investigation only with explicit authorization; otherwise label generated packages as not executed.

## Open decisions for the CTO

See [reports/m3-report.md §9](reports/m3-report.md#9-decisions-requested).
