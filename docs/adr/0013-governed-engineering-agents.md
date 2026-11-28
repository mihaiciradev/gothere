# ADR-0013: Governed engineering agents and platform-scope actions

Status: Accepted · 2026-11-28

## Context
The brief asks for AI-assisted incident analysis and, where budget permits, a controlled external coding-agent
investigation (e.g. Cursor Cloud Agent), with hard limits: no unrestricted self-modification, no automatic credit
consumption, explicit authorization for external execution, no agent approving its own changes, touching live
financial records or deploying, and an honest distinction between a generated package and an executed investigation.

## Decision
- **Platform scope in the Business Action Registry** (ADR-0009): `scope: "platform"`, authorized by the
  platform-admin role re-read from the database (never the session), no tenant. Approvals support it
  (`action_requests.organization_id` nullable; NULL-safe uniqueness and immutability, drizzle/0010).
- **Actions:**
  - `incident.read_report` (LOW): the sanitized report.
  - `incident.generate_investigation_package` (MEDIUM, no approval): a sanitized document with the report and
    constraints for an external agent (isolated branch, reproduce, regression test, PR for human review, no merge or
    deploy, no financial records). Writes a row; runs nothing.
  - `incident.dispatch_investigation` (HIGH, approval **always**, humans included, every severity): bound to the
    package id and the SHA-256 of its content. Execution requires a connected external agent.
- **External agent: not connected.** `src/infrastructure/external-agent.ts` reports "not configured" (credits need
  explicit authorization and no adapter is implemented). An approved dispatch therefore fails with that reason, the
  request is `failed`, the package stays `generated`, and the UI says "not executed". Nothing claims an execution.
- **Engineering agent** (`src/ai/engineering-agent.ts`): for a platform admin, the model receives only the sanitized
  report (declared untrusted data) and may call the package and dispatch tools through the executor with the admin's
  rights (initiator `ai_agent`); it has no approval tool. Its diagnosis must cite evidence ids present in the report;
  uncited causes are dropped and an ungrounded answer falls back to the runbook. Without AI, a fixed automation
  stores the runbook diagnosis and generates a package, and never requests a dispatch.
- **Severity never widens autonomy:** policies are per action; nothing reads severity (tested with a P0).

## Consequences
+ The whole governed flow (detect → analyse → package → request → approve → honest outcome) is demonstrable and
  tested without spending external credits.
+ Connecting a real agent is one adapter behind an existing approval gate; it still cannot merge, deploy or approve.
− No external investigation has actually run. Doing so needs a CTO decision (credits, repository access token scoped
  to a sandbox branch).
− On the deployed preview there is no platform admin (none is seeded outside local/test), so the Control Center is
  demonstrated locally unless the CTO decides otherwise.
