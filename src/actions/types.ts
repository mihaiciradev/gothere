import type { z } from "zod";
import type { DbExecutor } from "@/infrastructure/db/client";
import type { Actor } from "@/modules/identity";
import type { OrganizationPermission } from "@/modules/organizations";

export type Risk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
/** Who decided to invoke the action. The rights are always the actor's; the initiator only tightens policy. */
export type Initiator = "user" | "ai_agent" | "automation";

export type ActionContext = Readonly<{
  /** Root connection or an open transaction (approved requests execute inside the transaction that claims them). */
  db: DbExecutor;
  /** Resolved from the session. Null only for public, read-only actions (anonymous discovery). */
  actor: Actor | null;
  /** Tenant from the server-side context (route, session, approval record) — never from model output. */
  organizationId: string | null;
  initiator: Initiator;
  correlationId?: string;
  /** Rate-limit identity for anonymous callers (a keyed hash, never a raw id). */
  anonymousKey?: string;
}>;

/** What hooks receive: the context plus how effects are attributed in the audit trail. */
export type ExecutionContext = ActionContext & {
  audit: { actorType: "user" | "ai_agent" | "system"; correlationId?: string; metadata: Record<string, unknown> };
};

export type ActionDefinition<Input, Params, Output> = {
  id: string;
  title: string;
  /** Shown to the model and to approvers. Plain, factual, no instructions. */
  description: string;
  /** What a caller (human, API or model) may supply. Strict: unknown keys are rejected. */
  input: z.ZodType<Input>;
  /** Canonical, stored parameters after binding (equal to the input when there is nothing to bind). */
  params: z.ZodType<Params>;
  risk: Risk;
  scope: "public" | "organization";
  permission?: OrganizationPermission;
  /** `when_not_human`: an AI agent or automation needs a human approval; a human caller is already accountable. */
  approval: "none" | "when_not_human" | "always";
  limits: { perMinute: number };
  /** How duplicates are absorbed (documented contract, enforced by the implementation). */
  idempotency: string;
  /** Turns input into canonical params, e.g. adding the exact snapshot an approver will see. */
  bind?: (ctx: ExecutionContext, input: Input) => Promise<Params>;
  /** Business rules. Run before approval is requested and again immediately before execution. */
  preconditions?: (ctx: ExecutionContext, params: Params) => Promise<void>;
  execute: (ctx: ExecutionContext, params: Params) => Promise<Output>;
  /** One line for the approval inbox. */
  describe?: (params: Params) => string;
};

// Definitions are heterogeneous; the registry erases their generics at the boundary and re-validates with zod.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAction = ActionDefinition<any, any, any>;

export type ActionOutcome<Output = unknown> =
  | { status: "executed"; actionId: string; output: Output }
  | {
      status: "pending_approval";
      actionId: string;
      request: { id: string; paramsHash: string; expiresAt: Date; summary: string; duplicate: boolean };
    };
