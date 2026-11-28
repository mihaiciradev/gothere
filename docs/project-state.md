# Project state

Last updated: 2026-11-28 · Current milestone: **M3 conditionally approved; pre-M4 readiness done**. Do not start M4 until authorized.

Review packages: [reports/m0-report.md](reports/m0-report.md) · [reports/m1-report.md](reports/m1-report.md) · [reports/m2-report.md](reports/m2-report.md) · [reports/m3-report.md](reports/m3-report.md).

## Milestones

| Milestone | Status |
| --- | --- |
| M0 Architecture and foundation | ✅ Done (conditionally approved) |
| M1 Transactional ticketing engine | ✅ Done (conditionally approved) |
| M2 Attendee experience | ✅ Done |
| M3 AI and organizer intelligence | ✅ Done (conditionally approved) |
| M4 Engineering intelligence | ⏳ Next |
| M5 Verification and release | — |

## M3 delivered

- Demand signals (waitlist, sold-out views, unmatched searches) with keyed-hash subjects; seeded Sunset Sessions scenario (384 interested).
- Organizer interface: overview, event insights, intelligence (recommendations with evidence, proposal, assumptions, risks, outcome), approvals.
- Deterministic unmet-demand analysis; grounded briefs; outcome attribution from live orders.
- Business Action Registry with one executor for UI, API and AI; parameter-bound, single-use, expiring approvals (trigger-guarded).
- AI Gateway (Anthropic adapter, budget, timeouts, usage ledger), concierge and organiser agent, each with a deterministic fallback.
- Quality: 166 Vitest tests (40 unit, 126 integration), 42 Playwright tests on desktop and mobile including axe.

## Pre-M4 readiness (2026-11-28)

- Neon migrated (through 0008), seeded, restricted runtime role verified on direct and pooled connections; no administrator account. See [operations.md § Neon setup](operations.md#neon-setup).
- AI budget is a hard ceiling under concurrency (atomic reservations, migration 0008). Live Haiku inference verified for concierge, organiser agent and briefs: 26 calls, US$0.008605 total (cap US$0.02). See [operations.md § Runtime AI](operations.md#runtime-ai).
- CTO decisions recorded: single human approval for HIGH actions; keep current imagery; no public admin credentials; no paid infrastructure; runtime AI ceiling US$0.20/month.
- The production deployment is already public at https://gothere.mihaic.me (Git-connected; R-23).

## Known limitations

- No Control Center UI yet (M4). Living ticket is a placeholder.
- Waitlist does not send notifications (no email provider).
- Organizer screens cover intelligence and approvals; event and inventory editing are API-only.
- Imagery is hotlinked from Unsplash (R-17). No CSP yet (R-02, M5).
- No email verification, password reset or social sign-in. QR codes are display-only.
- Deployed via Git to Vercel production (public); release verification (M5) not done yet.

## Next actions (M4 — engineering intelligence, after review)

1. Structured operational events and incident records (fingerprint dedupe, severity P0–P3, correlation ids, technical and commercial impact).
2. Control Center (`/control`): health, incidents and timeline, transactions, AI usage and cost (`ai_usage_records` exists), audit.
3. Sanitized diagnostic reports and AI-assisted analysis through a registered `incident.investigate` action (approval always).
4. Optional external agent investigation only with explicit authorization; otherwise label generated packages as not executed.

## Open decisions for the CTO

- Whether the production deployment may stay public before M5 (R-23), or be closed until then.

See [reports/m3-report.md §9](reports/m3-report.md#9-decisions-requested).
