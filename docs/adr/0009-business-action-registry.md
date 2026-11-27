# ADR-0009: Business Action Registry and parameter-bound approvals

Status: Accepted · 2026-11-28

## Context
Humans, HTTP APIs and AI agents must perform business actions through the same rules. High-risk actions taken
for an agent need a human decision that cannot be manipulated, replayed or applied to something other than
what was reviewed.

## Decision
- `src/actions/registry.ts`: typed definitions (id, description, strict input schema, canonical params schema,
  risk, scope, permission, approval policy, rate limit, idempotency contract, `bind`, `preconditions`, `execute`,
  `describe`). Implemented for the MVP workflow only: `events.search`, `experiences.read_availability`,
  `analytics.read`, `demand.analyze`, `experience.create_draft`, `experience.publish`.
- `invokeAction` (`src/actions/executor.ts`) is the single entry point: resolve → policy (CRITICAL never for
  agents) → validate → authorize from the database with the tenant from server context → rate limit → bind →
  preconditions → approval gate or execute. Denials are audited. Effects are audited by the module services in the
  same transaction, attributed to `ai_agent` / `system` / `user`.
- The initiator (`user`, `ai_agent`, `automation`) only tightens policy; rights are always the acting user's.
  `approval: "when_not_human"` holds HIGH actions from agents and automations; a human calling directly is the
  accountable decision-maker.
- `experience.publish` binds a snapshot (title, times, time zone, capacity, price, currency) into its params, so
  the approver sees exactly what will go on sale; execution re-checks that the draft still matches.
- `action_requests`: canonical params, `params_hash = sha256(canonical JSON)`, 24 h expiry, unique open request per
  (action, tenant, hash). A trigger makes params, hash, requester, initiator and decision immutable, allows only
  forward transitions and forbids deletes.
- Deciding requires `action.approve` **and** the action's own permission, and the submitted hash must equal the
  stored one (which must still hash from the stored params). Approval executes immediately: one transaction flips
  `approved → executed` with a conditional update and runs the effect; replays and concurrent calls find no row.
  Requester and approver permissions and preconditions are re-checked at execution; a business failure rolls back
  the effect and marks the request `failed`. Only the approver can execute (retry path for a dropped connection).

## Consequences
+ The same code path serves the organiser UI (`/api/organizer/organizations/:id/actions/:actionId`), the agent
  and the concierge. Tested against real PostgreSQL: authorization, tenant pinning, hash mismatch, DB tampering,
  replay, expiry, concurrent execution, stale drafts, revoked requester.
− Approval is single-approver. Two-person rules (approver ≠ requester) are a policy switch for later.
− Expiry of untouched requests is lazy (on list/decide), which is sufficient because execution also checks it.
