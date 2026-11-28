# Project state

Last updated: 2026-11-28 · Current milestone: **M4 complete — awaiting independent review**. Do not start M5 until the review is closed.

Review packages: [reports/m0-report.md](reports/m0-report.md) · [reports/m1-report.md](reports/m1-report.md) · [reports/m2-report.md](reports/m2-report.md) · [reports/m3-report.md](reports/m3-report.md) · [reports/m4-report.md](reports/m4-report.md).

## Milestones

| Milestone | Status |
| --- | --- |
| M0 Architecture and foundation | ✅ Done (conditionally approved) |
| M1 Transactional ticketing engine | ✅ Done (conditionally approved) |
| M2 Attendee experience | ✅ Done |
| M3 AI and organizer intelligence | ✅ Done (approved) |
| M4 Engineering intelligence | ✅ Done (pending review) |
| M5 Verification and release | ⏳ Next |

## M3 delivered

- Demand signals (waitlist, sold-out views, unmatched searches) with keyed-hash subjects; seeded Sunset Sessions scenario (384 interested).
- Organizer interface: overview, event insights, intelligence (recommendations with evidence, proposal, assumptions, risks, outcome), approvals.
- Deterministic unmet-demand analysis; grounded briefs; outcome attribution from live orders.
- Business Action Registry with one executor for UI, API and AI; parameter-bound, single-use, expiring approvals (trigger-guarded).
- AI Gateway (Anthropic adapter, budget, timeouts, usage ledger), concierge and organiser agent, each with a deterministic fallback.
- Quality: 166 Vitest tests (40 unit, 126 integration), 42 Playwright tests on desktop and mobile including axe.

## M4 delivered (2026-11-28)

- Pre-M4 hardening: server-side access gate (fail-closed), CSP, privacy notice, AI only for signed-in visitors (ADR-0011).
- Incidents: sanitized append-only operational events, deduplicated incidents, severity, technical and commercial impact, detectors in every maintenance pass, route-level error detection (ADR-0012).
- Governed engineering agents: platform-scope actions, engineering agent (AI with checked citations or runbook), investigation packages, external dispatch always approved and not connected (ADR-0013).
- Control Center: health, incidents, transactions, AI usage, audit; simulated scenarios labelled apart from live telemetry.
- Quality: 201 Vitest tests (55 unit, 146 integration), 52 Playwright tests (desktop + mobile, axe).

## Pre-M4 readiness (2026-11-28)

- Neon migrated (through 0008), seeded, restricted runtime role verified on direct and pooled connections; no administrator account. See [operations.md § Neon setup](operations.md#neon-setup).
- AI budget is a hard ceiling under concurrency (atomic reservations, migration 0008). Live Haiku inference verified for concierge, organiser agent and briefs: 26 calls, US$0.008605 total (cap US$0.02). See [operations.md § Runtime AI](operations.md#runtime-ai).
- CTO decisions recorded: single human approval for HIGH actions; keep current imagery; no public admin credentials; no paid infrastructure; runtime AI ceiling US$0.20/month.
- The production deployment is already public at https://gothere.mihaic.me (Git-connected; R-23).

## Known limitations

- Living ticket is a placeholder. No external coding agent is connected (packages are generated, not executed).
- No platform admin on the deployed preview (seeded only locally), so the Control Center is demonstrated locally.
- Detection is pull-based with no alert channel (R-27); browser errors are not collected.
- Waitlist does not send notifications (no email provider).
- Organizer screens cover intelligence and approvals; event and inventory editing are API-only.
- Imagery is hotlinked from Unsplash (R-17). No CSP yet (R-02, M5).
- No email verification, password reset or social sign-in. QR codes are display-only.
- Deployed via Git to Vercel production (public); release verification (M5) not done yet.

## Next actions (M5 — verification and release, after review)

1. End-to-end and security verification against the deployed preview (behind the gate), including CSP review.
2. Controlled k6 load test of reservations and checkout against a non-production database; publish measured results.
3. Performance pass on the heaviest pages; visual refinement.
4. Release checklist: remove the gate (SITE_ACCESS=open) only after sign-off; alert sink decision (R-27).

## Open decisions for the CTO

- Whether the production deployment may stay public before M5 (R-23), or be closed until then.

See [reports/m3-report.md §9](reports/m3-report.md#9-decisions-requested).
