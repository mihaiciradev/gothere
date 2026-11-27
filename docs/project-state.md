# Project state

Last updated: 2026-11-27 · Current milestone: **M2 complete — awaiting independent review**. Do not start M3 until the review is closed.

Review packages: [reports/m0-report.md](reports/m0-report.md) · [reports/m1-report.md](reports/m1-report.md) · [reports/m2-report.md](reports/m2-report.md).

## Milestones

| Milestone | Status |
| --- | --- |
| M0 Architecture and foundation | ✅ Done (conditionally approved) |
| M1 Transactional ticketing engine | ✅ Done (conditionally approved) |
| M2 Attendee experience | ✅ Done (pending review) |
| M3 AI and organizer intelligence | ⏳ Next |
| M4 Engineering intelligence | — |
| M5 Verification and release | — |

## M2 delivered

- Pre-M2 review fixes: provider success after a failed attempt is reconciled (accepted or refunded), inferred failures are verified with the provider, unreconciled-success report; payment Idempotency-Keys bound to request parameters.
- Attendee interface: home, discover, event detail with ticket selection, sign-in/up with safe redirects and selection carried through sign-in, checkout (simulated payment, countdown from DB clock, failure/retry, pending, expired, refund notices), wallet and ticket pass with server-rendered QR; designed 404 and error states.
- Content: six fictional events across two organisers with licensed photography and credits ([assets.md](assets.md)); catalogue search, facets and availability status in the `events` module.
- Quality: 124 Vitest tests, 36 Playwright tests on desktop and mobile including axe accessibility scans; screenshots in `docs/reports/m2/`.

## Known limitations

- No organizer or Control Center UI yet (M3/M4). Concierge and living ticket are honest placeholders.
- Waitlist / "notify me" for sold-out sessions is a labelled slot only; demand capture arrives with M3.
- Imagery is hotlinked from Unsplash (R-17). No CSP yet (R-02, M5).
- No email verification, password reset or social sign-in.
- QR codes are display-only; no check-in.
- Not deployed.

## Next actions (M3 — AI and organizer intelligence, after review)

1. Demand signals: capture searches with no/low results, sold-out views and waitlist requests (the sold-out slot on the event page).
2. AI Gateway (Anthropic SDK, Haiku via env, budgets, timeouts, usage records) and the concierge on `/discover` using registry actions only.
3. Business Action Registry with approvals bound to parameter hashes; `experience.create_draft` and `experience.publish` as the flagship flow.
4. Organizer dashboard (`/organizer`): sales, unmet demand for Sunset Sessions, recommendation with evidence and revenue assumptions, approval inbox.
5. Attribution of sales to recommendation-created experiences.

## Open decisions for the CTO

See [reports/m2-report.md §11](reports/m2-report.md#11-decisions-requested).
