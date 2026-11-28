# Business Action Registry

> Status: **implemented in M3** (`src/actions/`). Decisions: [ADR-0009](adr/0009-business-action-registry.md),
> AI side: [ADR-0008](adr/0008-ai-gateway.md), analysis: [ADR-0010](adr/0010-grounded-demand-analysis.md).

Every business capability an agent may use is a registered action. Humans, HTTP APIs and AI tools invoke it
through the same executor, so validation, authorization, idempotency and audit are identical.

## Action definition (`src/actions/types.ts`)

```ts
type ActionDefinition<Input, Params, Output> = {
  id: string; title: string; description: string;   // description is shown to the model and to approvers
  input: ZodType<Input>;                              // what a caller may supply (strict)
  params: ZodType<Params>;                            // canonical stored parameters after binding
  risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  scope: "public" | "organization";
  permission?: OrganizationPermission;
  approval: "none" | "when_not_human" | "always";
  limits: { perMinute: number };
  idempotency: string;                                // contract, enforced by the implementation
  bind?(ctx, input): Promise<Params>;                 // e.g. snapshot the draft being published
  preconditions?(ctx, params): Promise<void>;         // run before requesting approval and before executing
  execute(ctx, params): Promise<Output>;              // calls module services, never SQL
  describe?(params): string;                          // one line for the approval inbox
};
```

## Registered actions

| Id | Risk | Scope / permission | Approval | Idempotency |
| --- | --- | --- | --- | --- |
| `events.search` | LOW | public | none | read-only |
| `experiences.read_availability` | LOW | public | none | read-only |
| `analytics.read` | LOW | `analytics.read` | none | read-only |
| `demand.analyze` | LOW | `recommendation.read` | none | one recommendation per sold-out session; re-run refreshes open ones |
| `experience.create_draft` | MEDIUM | `experience.write` | none (private draft) | one draft per recommendation; repeat returns it |
| `experience.publish` | HIGH | `experience.publish` | when initiated by an agent or automation | unique open request per parameters; executes once |
| `incident.read_report` | LOW | platform admin | none | read-only |
| `incident.generate_investigation_package` | MEDIUM | platform admin | none | a package from the last hour is reused |
| `incident.dispatch_investigation` | HIGH | platform admin | **always** (people too; any severity) | bound to package id + content hash; executes once; fails "not executed" while no external agent is connected |

CRITICAL actions (refunds, deleting events, payouts) are not registered; the executor refuses CRITICAL for
non-human initiators anyway. Platform-scope actions (M4) are authorized by the platform-admin role read from the
database and have no organization; their approvals live in the Control Center ([ADR-0013](adr/0013-governed-engineering-agents.md)).

## Execution pipeline (`invokeAction`)

1. Resolve the action (unknown → `NOT_FOUND`). Policy: CRITICAL never for `ai_agent` / `automation`.
2. Validate input (strict: unknown keys such as an `organizationId` from a model are rejected).
3. Organization scope: actor required; `requireOrganizationPermission(actor, ctx.organizationId, permission)`. The
   tenant comes from server context (route, approval record), never from input. Resources referenced by id are
   pinned to that tenant (`NOT_FOUND` otherwise).
4. Rate limit per action and actor (or anonymous subject hash).
5. Bind canonical params; run preconditions.
6. Approval required → `action_requests` row (`pending_approval`, hash, 24 h expiry) and return
   `{ status: "pending_approval" }`. Otherwise execute; services audit inside their transaction with
   `actor_type = user | ai_agent | system` and the initiator.
7. FORBIDDEN / NOT_FOUND / UNAUTHENTICATED / RATE_LIMITED on organization actions are audited as `denied`.

## Approvals (`src/actions/approvals.ts`)

- Bound to `(action_id, organization_id, params_hash)`; the inbox shows the exact params (for publication: title,
  start in event time, places, price) and the hash.
- Deciding requires `action.approve` and the action's own permission; the request must be pending and unexpired;
  the submitted hash must equal the stored hash, which must still be the hash of the stored params.
- Approval executes in one transaction: `UPDATE … SET status='executed' WHERE status='approved' AND expires_at >
  now()` plus the effect. A replay or concurrent call updates 0 rows → `CONFLICT`. Requester and approver
  permissions and preconditions are re-checked; a business failure rolls back and marks the request `failed`.
- The database forbids changing params, hash, requester, initiator, risk or decision, backward transitions and
  deletes (`drizzle/0007_action_request_guards.sql`).
- An AI agent has no approve tool and cannot obtain one: decisions are only reachable from an authenticated human
  route.

## Model boundary

- Tool definitions are generated from the registry (`src/ai/action-tools.ts`: name with `_`, description, JSON
  schema of `input`). Each tool call goes through `invokeAction` with the caller's actor and server-side tenant.
- Concierge: only `events_search` and `experiences_read_availability`. Picks are filtered to slugs the tools
  returned; cards are rendered from the database; money or multi-digit numbers in model prose are replaced.
- Organiser agent: only `experience_create_draft` and `experience_publish` (which yields `pending_approval`).
- Attendee messages and recommendation facts are wrapped in tags and declared untrusted data in the system prompt.
- Recommendation briefs are stored only if every number they cite belongs to the recommendation (ADR-0010).
