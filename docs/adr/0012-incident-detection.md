# ADR-0012: Operational events, deduplicated incidents and computed impact

Status: Accepted · 2026-11-28

## Context
M4 needs error detection, structured incidents, correlation ids, deduplication, severity, technical and commercial
impact, and sanitized diagnostics on the existing serverless stack, without new infrastructure (no paid monitoring
service) and without triggering real incidents for demonstration.

## Decision
- **One module, `incidents`**, owns `operational_events` (append-only evidence, trigger-guarded), `incidents`,
  `incident_timeline` and `investigation_packages`. Everything stored passes `sanitize` first (emails, URL
  credentials, bearer/JWT/API-key tokens, card-like numbers and long opaque strings removed; secret-named keys
  redacted; sizes bounded); UUIDs, routes, error names, codes and correlation ids are kept.
- **Sources** (all call `recordOperationalEvent`, which never throws):
  - the API route wrapper: every unhandled 500 → `http.unhandled_error` (method, normalised path, error name,
    project stack frames, correlation id), recorded after the response;
  - the maintenance pass: failed stages, reservations the sweep had to skip (with held units and price);
  - detectors run in every maintenance pass: inventory counters below their active holds, provider successes left
    without an order or refund for 10 minutes, dead jobs (payment jobs P1);
  - the AI gateway: provider failures (P3) and budget exhaustion (once per month).
- **Deduplication:** fingerprint = hash(origin, kind, discriminating parts). A partial unique index allows one
  unresolved incident per fingerprint; occurrences attach to it under an advisory lock. Detectors that re-scan a
  persistent condition pass a dedupe key (unique with the fingerprint), so a scan never inflates the count.
  Resolution is terminal; a recurrence opens a new incident.
- **Severity** comes from the incident catalogue (`domain/catalogue.ts`): purchase-path failures, payment and
  inventory integrity P1; other routes P2; AI P3. It only ever rises. P0 is reserved for humans to set (security or
  production-wide outages): no detector claims it.
- **Impact** is recomputed from the stored evidence: technical (occurrences, window, routes, stages, correlation ids)
  and commercial from amounts the detectors read from the database (value at risk, payments, units, holds). Failed
  requests are counted, never priced.
- **Origin** `live` vs `simulated` on every event and incident; simulated scenarios are records only, have their own
  fingerprints, are refused in production and are labelled and counted separately in the Control Center.

## Consequences
+ Detection and triage run on PostgreSQL alone; the real bug class found in M3 verification (counter drift) is now a
  P1 incident with a value at risk instead of a silent stall.
+ Evidence is safe to show a model or an external agent by construction.
− Detection is pull-based (maintenance passes: opportunistic, cron daily, manual) plus request-time errors; there is
  no paging/alerting channel. A production setup would add an alert sink (email/Slack) behind the same recorder.
− Client-side (browser) errors are not collected.
