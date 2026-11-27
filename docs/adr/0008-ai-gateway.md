# ADR-0008: Provider-independent AI Gateway with deterministic fallbacks

Status: Accepted · 2026-11-28

## Context
Runtime AI (concierge, organiser briefs, organiser agent) must not become a dependency of ticketing, must not
invent catalogue facts, must stay within a cost ceiling, and must not assume a specific model entitlement. No
Anthropic credentials are configured in this environment, and spending credits needs explicit authorisation.

## Decision
- `src/ai/gateway.ts` is the only code that calls a model. Provider-neutral message and tool types
  (`src/ai/types.ts`); the Anthropic adapter (`src/ai/providers/anthropic.ts`, official SDK) is one implementation.
  Provider-native assistant content is replayed verbatim to the same provider.
- Configuration is server-side env only: `ANTHROPIC_API_KEY`, `AI_MODEL_FAST` (Opus ids are rejected by the env
  schema), `AI_MONTHLY_BUDGET_MINOR` (US cents), optional prices. AI is **off** unless all are present; the
  composition root (`src/composition/ai.ts`) then builds a gateway with no provider.
- Every call: monthly budget checked first (database ledger), per-run deadline + per-call abort signal, one SDK
  retry, bounded tool loop (steps and tool calls), schema-validated final answer through a "final" tool (no forced
  `tool_choice`, which some models reject), `effort: low`, usage and integer micro-USD cost recorded in
  `ai_usage_records` (no prompt content), sanitized logs with correlation ids.
- The gateway never throws for provider problems; callers receive a typed failure and run a deterministic path:
  the concierge falls back to intent parsing + catalogue search, the organiser agent to a fixed automation that
  invokes the same governed actions, briefs to rules text. The UI says which path answered.
- Tools are registry actions (ADR-0009). The concierge gets only public, read-only actions; the model's picks are
  filtered to slugs its tools returned, and cards are hydrated from the database, so prices and availability never
  come from model text.

## Consequences
+ The product is fully usable, and every AI path is tested, without credentials (scripted fake provider in tests).
+ Swapping providers touches one adapter.
− Without credentials no real-model quality is demonstrated. Enabling AI is a CTO decision (key, model id, budget).
− Budget check is check-then-call: concurrent calls can overshoot by at most one call each (bounded by token caps).
