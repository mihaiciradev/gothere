# Business Action Registry

> Status: **design** (implementation in M3). This file is the contract the implementation must meet.

Every business capability that an AI agent may use is a registered action. Humans, HTTP APIs and AI tools invoke the same action through the same executor, so authorization, validation, idempotency and audit are identical whichever interface calls it.

## Action definition

```ts
type ActionDefinition<I, O> = {
  id: string;                         // stable, e.g. "experience.create_draft"
  description: string;                // shown to the model and to approvers
  input: ZodType<I>;                  // validated before anything else
  output: ZodType<O>;
  permission: OrganizationPermission; // checked via requireOrganizationPermission
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  approval: "none" | "required_when_ai_initiated" | "always";
  preconditions(ctx, input): Promise<void>;   // business rules, re-run at execution
  idempotency: "natural" | "key";             // how duplicates are absorbed
  limits: { perMinute: number; perDay?: number };
  execute(ctx, input): Promise<O>;            // calls module services, never SQL
};
```

## Initial actions

| Id | Risk | Permission | Approval |
| --- | --- | --- | --- |
| `events.search` | LOW | public | none |
| `experiences.read_availability` | LOW | public | none |
| `analytics.read` | LOW | `analytics.read` | none |
| `demand.analyze` | LOW | `recommendation.read` | none |
| `experience.create_draft` | MEDIUM | `experience.write` | none (draft is private) |
| `experience.publish` | HIGH | `experience.publish` | required when AI-initiated |
| `incident.investigate` | HIGH | platform admin | always (spends external credits) |

CRITICAL (refunds, deleting events, changing payouts) is not exposed to AI at all in the MVP.

## Execution pipeline

1. Resolve the actor from the session (AI acts **as** the invoking user, never with more rights).
2. Validate input with the action's schema.
3. `requireOrganizationPermission(actor, organizationId, action.permission)` — tenant id comes from the server-side context, not from the model.
4. Run preconditions.
5. If approval is required: create `action_request` with canonical parameters and `params_hash = sha256(canonical JSON)`, status `pending_approval`, expiry; stop.
6. Execute inside a transaction with an audit record (`actor_type = ai_agent | user`, correlation id).

## Approvals

- Bound to `(action_id, organization_id, params_hash)`. The approver sees exactly those parameters.
- Approving records approver identity and time. The approver must independently hold the action's permission.
- Execution re-validates permission and preconditions, compares the stored hash, and atomically flips `approved → executed` (`UPDATE … WHERE status = 'approved'`): a replay finds 0 rows.
- Approvals expire (default 24 h). Expired or rejected requests cannot execute.
- Only a human user holding the permission can approve; an AI agent never can. Human-initiated actions of the same risk do not need approval, because the human is already the accountable decision-maker.

## Model boundary

- The model receives tool definitions generated from the registry (id, description, input JSON schema) for actions the current actor is allowed to call.
- Tool results are data. Untrusted text (descriptions, messages) is delimited and never interpreted as instructions.
- Numeric claims in recommendations must cite query results returned by `analytics.read` / `demand.analyze`.
