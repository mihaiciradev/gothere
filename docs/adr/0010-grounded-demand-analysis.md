# ADR-0010: Deterministic unmet-demand analysis; AI writes words, never numbers

Status: Accepted · 2026-11-28

## Context
Recommendations must be grounded in application data, distinguish estimates from revenue and never treat
interest as conversion. Language models are unreliable with figures.

## Decision
- Demand signals (`demand_signals`): `waitlist_request` (signed-in "Notify me"), `sold_out_view` (event page
  shown with sold-out items; after render, never on prefetch), `search_unmatched` (catalogue or concierge search
  with no result; the server re-checks before recording, and the concierge stores parsed intent, not free text).
  Subjects are keyed hashes (HMAC with a domain-separated server secret) of a user id or a random first-party
  visitor id; partial unique indexes make every signal idempotent per subject (and per day for views/searches).
- `analytics/domain/opportunity.ts` (pure) turns a sold-out session with enough distinct interest
  (≥ max(20, 25 % of capacity)) into a second-session proposal: capacity = original, reduced to interest; price
  +15 % rounded when interest ≥ 2× capacity, else unchanged; same local time the next (or previous) day inside the
  event, DST-safe; maximum gross; 25/50/75 % conversion scenarios capped at capacity; risks. Seeded signals are
  flagged as a risk.
- `commercial_recommendations` store evidence, proposal, assumptions and risks as computed. The narrative is
  rules text by default; a model-written brief is stored only if every number in it appears in the
  recommendation's own figures (`ungroundedNumbers`). Refreshing an open recommendation resets the brief.
- Drafts created from a recommendation take capacity, price and time from the stored proposal; the model only
  chooses which recommendation. Outcomes are measured from live confirmed orders of that experience only.

## Consequences
+ The flagship example reproduces exactly from seeded data: 384 interested, 150 places at EUR 35, EUR 5,250 max.
+ Recommendations are explainable and testable; AI failure never changes a figure.
− The rule set is deliberately simple (one opportunity type). Richer models (price elasticity, cannibalisation)
  need real sales history.
