import { ZodError } from "zod";
import { logger } from "@/infrastructure/logging/logger";
import { recordAudit } from "@/modules/audit";
import { consumeRateLimit } from "@/modules/operations";
import { requireOrganizationPermission } from "@/modules/organizations";
import { AppError, isAppError } from "@/shared/errors";
import { createActionRequest } from "./approvals";
import { getAction } from "./registry";
import type { ActionContext, ActionOutcome, AnyAction, ExecutionContext } from "./types";

const auditActorType = (ctx: ActionContext) => (ctx.initiator === "user" ? "user" : ctx.initiator === "ai_agent" ? "ai_agent" : "system") as "user" | "ai_agent" | "system";

export function executionContext(ctx: ActionContext, metadata: Record<string, unknown> = {}): ExecutionContext {
  return {
    ...ctx,
    audit: { actorType: auditActorType(ctx), correlationId: ctx.correlationId, metadata: { initiator: ctx.initiator, ...metadata } },
  };
}

export function requiresApproval(action: AnyAction, initiator: ActionContext["initiator"]): boolean {
  return action.approval === "always" || (action.approval === "when_not_human" && initiator !== "user");
}

function toValidationError(error: ZodError): AppError {
  return new AppError("VALIDATION_FAILED", "The action input is invalid.", {
    issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}

/**
 * The single entry point for business actions, whichever interface calls them (UI route, HTTP API, AI tool).
 * Order: resolve → policy → validate → authorize (tenant from context) → rate limit → bind → preconditions →
 * approval gate or execute. Denials are audited; effects are audited by the module services they call.
 */
export async function invokeAction(ctx: ActionContext, actionId: string, rawInput: unknown): Promise<ActionOutcome> {
  const action = getAction(actionId);
  try {
    if (action.risk === "CRITICAL" && ctx.initiator !== "user") {
      throw new AppError("FORBIDDEN", "This action cannot be initiated by an agent.");
    }

    let input: unknown;
    try {
      input = action.input.parse(rawInput);
    } catch (error) {
      throw error instanceof ZodError ? toValidationError(error) : error;
    }

    if (action.scope === "organization") {
      if (!ctx.actor) throw new AppError("UNAUTHENTICATED", "Sign in to continue.");
      if (!ctx.organizationId || !action.permission) throw new AppError("FORBIDDEN", "This action needs an organization context.");
      await requireOrganizationPermission(ctx.db, ctx.actor, ctx.organizationId, action.permission);
    }

    const rateKey = ctx.actor?.userId ?? ctx.anonymousKey ?? "anonymous";
    await consumeRateLimit(ctx.db, `action:${action.id}:${rateKey}`, { limit: action.limits.perMinute, windowSeconds: 60 });

    const exec = executionContext(ctx);
    const params = action.params.parse(action.bind ? await action.bind(exec, input) : input);
    await action.preconditions?.(exec, params);

    if (requiresApproval(action, ctx.initiator)) {
      const request = await createActionRequest(exec, action, params);
      return { status: "pending_approval", actionId: action.id, request };
    }

    const output = await action.execute(exec, params);
    return { status: "executed", actionId: action.id, output };
  } catch (error) {
    if (isAppError(error) && ["FORBIDDEN", "NOT_FOUND", "UNAUTHENTICATED", "RATE_LIMITED"].includes(error.code) && action.scope === "organization") {
      await recordAudit(ctx.db, {
        actorType: auditActorType(ctx),
        actorUserId: ctx.actor?.userId ?? null,
        organizationId: ctx.organizationId,
        action: action.id,
        outcome: "denied",
        correlationId: ctx.correlationId,
        metadata: { initiator: ctx.initiator, code: error.code },
      }).catch((auditError) => logger.error("failed to audit action denial", { error: auditError }));
    }
    throw error;
  }
}
