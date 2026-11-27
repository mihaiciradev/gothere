import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, DbExecutor } from "@/infrastructure/db/client";
import { actionRequests, users } from "@/infrastructure/db/schema";
import { recordAudit } from "@/modules/audit";
import type { Actor } from "@/modules/identity";
import { requireOrganizationPermission } from "@/modules/organizations";
import { AppError, isAppError, toPublicError } from "@/shared/errors";
import { assertUuid } from "@/shared/ids";
import { canonicalJson, paramsHash } from "./canonical";
import { getAction } from "./registry";
import type { AnyAction, ExecutionContext } from "./types";

export const APPROVAL_TTL_HOURS = 24;

const openStatuses = ["pending_approval", "approved"] as const;

/** Records a request for approval. A second request with identical parameters returns the open one. */
export async function createActionRequest(ctx: ExecutionContext, action: AnyAction, params: unknown) {
  if (!ctx.actor || !ctx.organizationId) throw new AppError("FORBIDDEN", "Approval requests need an organization context.");
  const hash = paramsHash(params);
  const canonical = JSON.parse(canonicalJson(params)) as Record<string, unknown>;
  const recommendationId = typeof (params as { recommendationId?: unknown }).recommendationId === "string" ? (params as { recommendationId: string }).recommendationId : null;
  const summary = action.describe?.(params) ?? action.title;

  const [created] = await ctx.db
    .insert(actionRequests)
    .values({
      actionId: action.id,
      organizationId: ctx.organizationId,
      requestedByUserId: ctx.actor.userId,
      initiator: ctx.initiator,
      risk: action.risk,
      params: canonical,
      paramsHash: hash,
      expiresAt: sql`now() + make_interval(hours => ${APPROVAL_TTL_HOURS})`,
      recommendationId,
      correlationId: ctx.correlationId,
    })
    .onConflictDoNothing({
      target: [actionRequests.actionId, actionRequests.organizationId, actionRequests.paramsHash],
      where: sql`${actionRequests.status} IN ('pending_approval', 'approved')`,
    })
    .returning();

  const row =
    created ??
    (
      await ctx.db
        .select()
        .from(actionRequests)
        .where(
          and(
            eq(actionRequests.actionId, action.id),
            eq(actionRequests.organizationId, ctx.organizationId),
            eq(actionRequests.paramsHash, hash),
            inArray(actionRequests.status, [...openStatuses]),
          ),
        )
    )[0];
  if (!row) throw new AppError("CONFLICT", "The approval request could not be recorded; try again.");

  if (created) {
    await recordAudit(ctx.db, {
      actorType: ctx.audit.actorType,
      actorUserId: ctx.actor.userId,
      organizationId: ctx.organizationId,
      action: "action.request_approval",
      targetType: "action_request",
      targetId: row.id,
      outcome: "succeeded",
      correlationId: ctx.correlationId,
      metadata: { actionId: action.id, paramsHash: hash, initiator: ctx.initiator },
    });
  }
  return { id: row.id, paramsHash: row.paramsHash, expiresAt: row.expiresAt, summary, duplicate: !created };
}

async function expireOverdue(db: DbExecutor, organizationId: string) {
  await db
    .update(actionRequests)
    .set({ status: "expired" })
    .where(and(eq(actionRequests.organizationId, organizationId), inArray(actionRequests.status, [...openStatuses]), sql`${actionRequests.expiresAt} <= now()`));
}

export type ActionRequestView = {
  id: string;
  actionId: string;
  actionTitle: string;
  risk: string;
  summary: string;
  initiator: "user" | "ai_agent" | "automation";
  status: (typeof actionRequests.$inferSelect)["status"];
  params: Record<string, unknown>;
  paramsHash: string;
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  executedAt: Date | null;
  errorCode: string | null;
  result: Record<string, unknown> | null;
  recommendationId: string | null;
  expiresAt: Date;
  createdAt: Date;
};

/** The approval inbox: everything for the organization, newest first. Readable by anyone who can see recommendations. */
export async function listActionRequests(db: Database, actor: Actor, organizationId: string): Promise<ActionRequestView[]> {
  assertUuid(organizationId, "Organization");
  await requireOrganizationPermission(db, actor, organizationId, "recommendation.read");
  await expireOverdue(db, organizationId);
  const rows = await db
    .select({ request: actionRequests, requester: { id: users.id, name: users.name } })
    .from(actionRequests)
    .innerJoin(users, eq(users.id, actionRequests.requestedByUserId))
    .where(eq(actionRequests.organizationId, organizationId))
    .orderBy(desc(actionRequests.createdAt))
    .limit(100);
  const deciderIds = [...new Set(rows.map((r) => r.request.decidedByUserId).filter((id): id is string => !!id))];
  const deciders = deciderIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, deciderIds)) : [];
  const deciderName = new Map(deciders.map((d) => [d.id, d.name]));

  return rows.map(({ request: r, requester }) => {
    const action = getAction(r.actionId);
    return {
      id: r.id,
      actionId: r.actionId,
      actionTitle: action.title,
      risk: r.risk,
      summary: action.describe?.(r.params) ?? action.title,
      initiator: r.initiator,
      status: r.status,
      params: r.params,
      paramsHash: r.paramsHash,
      requestedBy: requester,
      decidedBy: r.decidedByUserId ? { id: r.decidedByUserId, name: deciderName.get(r.decidedByUserId) ?? "Unknown" } : null,
      decidedAt: r.decidedAt,
      decisionNote: r.decisionNote,
      executedAt: r.executedAt,
      errorCode: r.errorCode,
      result: r.result,
      recommendationId: r.recommendationId,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    };
  });
}

export const decisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    /** The hash of the parameters the approver reviewed; must match the stored request exactly. */
    paramsHash: z.string().regex(/^[0-9a-f]{64}$/),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

const requesterActor = (userId: string): Actor => ({ kind: "user", userId, email: "", platformRole: "attendee" });

/**
 * A human decision on a pending request. The approver must be a member holding `action.approve` and the action's
 * own permission, and must submit the parameter hash they reviewed. Approval then executes the action.
 */
export async function decideActionRequest(
  db: Database,
  actor: Actor,
  requestId: string,
  input: unknown,
  options: { correlationId?: string; organizationId?: string } = {},
) {
  assertUuid(requestId, "Request");
  const decision = decisionSchema.parse(input);

  const decided = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(actionRequests).where(eq(actionRequests.id, requestId)).for("update");
    if (!row || (options.organizationId && row.organizationId !== options.organizationId)) throw new AppError("NOT_FOUND", "Request not found.");
    const action = getAction(row.actionId);
    await requireOrganizationPermission(tx, actor, row.organizationId, "action.approve");
    if (action.permission) await requireOrganizationPermission(tx, actor, row.organizationId, action.permission);

    const [{ expired }] = (await tx.execute<{ expired: boolean }>(sql`SELECT ${row.expiresAt.toISOString()}::timestamptz <= now() AS expired`)).rows as [{ expired: boolean }];
    if (row.status === "pending_approval" && expired) {
      await tx.update(actionRequests).set({ status: "expired" }).where(eq(actionRequests.id, row.id));
      return { row, outcome: "expired" as const };
    }
    if (row.status !== "pending_approval") throw new AppError("CONFLICT", `This request is already ${row.status.replace("_", " ")}.`);

    // Integrity: the stored parameters must still hash to the stored hash (the trigger forbids edits; this is the second wall).
    if (paramsHash(row.params) !== row.paramsHash) throw new AppError("INTERNAL", "Stored parameters failed their integrity check.");
    if (decision.paramsHash !== row.paramsHash) {
      await recordAudit(tx, {
        actorType: "user",
        actorUserId: actor.userId,
        organizationId: row.organizationId,
        action: "action.decide",
        targetType: "action_request",
        targetId: row.id,
        outcome: "denied",
        correlationId: options.correlationId,
        metadata: { reason: "params_hash_mismatch" },
      });
      throw new AppError("CONFLICT", "These are not the parameters you reviewed. Reload the request and review it again.");
    }

    const status = decision.decision === "approve" ? "approved" : "rejected";
    await tx
      .update(actionRequests)
      .set({ status, decidedByUserId: actor.userId, decidedAt: sql`now()`, decisionNote: decision.note ?? null })
      .where(and(eq(actionRequests.id, row.id), eq(actionRequests.status, "pending_approval")));
    await recordAudit(tx, {
      actorType: "user",
      actorUserId: actor.userId,
      organizationId: row.organizationId,
      action: `action.${status === "approved" ? "approve" : "reject"}`,
      targetType: "action_request",
      targetId: row.id,
      outcome: "succeeded",
      correlationId: options.correlationId,
      metadata: { actionId: row.actionId, paramsHash: row.paramsHash, requestedBy: row.requestedByUserId, initiator: row.initiator },
    });
    return { row, outcome: status };
  });

  if (decided.outcome === "expired") throw new AppError("PRECONDITION_FAILED", "This request has expired. Ask for it again.");
  if (decided.outcome === "rejected") return { status: "rejected" as const };
  return executeApprovedRequest(db, actor, requestId, options);
}

/**
 * Runs an approved request exactly once. The flip `approved → executed` and the business effect commit in one
 * transaction; a concurrent or repeated call finds no approved row and is rejected. Permissions of requester and
 * approver and the action's preconditions are re-checked first. A business failure rolls the effect back and
 * marks the request failed.
 */
export async function executeApprovedRequest(db: Database, approver: Actor, requestId: string, options: { correlationId?: string; organizationId?: string } = {}) {
  assertUuid(requestId, "Request");
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(actionRequests)
        .set({ status: "executed", executedAt: sql`now()` })
        .where(
          and(
            eq(actionRequests.id, requestId),
            eq(actionRequests.status, "approved"),
            sql`${actionRequests.expiresAt} > now()`,
            options.organizationId ? eq(actionRequests.organizationId, options.organizationId) : undefined,
          ),
        )
        .returning();
      if (!row) throw new AppError("CONFLICT", "This request is not approved, has expired or was already executed.");
      if (row.decidedByUserId !== approver.userId) throw new AppError("FORBIDDEN", "Only the approver can execute this request.", { stage: "claim" });

      const action = getAction(row.actionId);
      const params = action.params.parse(row.params);
      if (action.permission) {
        await requireOrganizationPermission(tx, requesterActor(row.requestedByUserId), row.organizationId, action.permission);
        await requireOrganizationPermission(tx, approver, row.organizationId, action.permission);
      }
      await requireOrganizationPermission(tx, approver, row.organizationId, "action.approve");

      const exec: ExecutionContext = {
        db: tx,
        actor: approver,
        organizationId: row.organizationId,
        initiator: "user",
        correlationId: options.correlationId,
        audit: {
          actorType: "user",
          correlationId: options.correlationId,
          metadata: { actionRequestId: row.id, requestedBy: row.requestedByUserId, initiator: row.initiator, paramsHash: row.paramsHash },
        },
      };
      await action.preconditions?.(exec, params);
      const output = await action.execute(exec, params);
      const result = JSON.parse(JSON.stringify(output ?? {})) as Record<string, unknown>;
      await tx.update(actionRequests).set({ result }).where(eq(actionRequests.id, row.id));
      return { status: "executed" as const, output: result };
    });
  } catch (error) {
    // Replays and wrong-approver calls change nothing; only a genuine business failure marks the request failed.
    if (!isAppError(error) || error.code === "CONFLICT" || error.details?.stage === "claim") throw error;
    const failure = toPublicError(error);
    const [failed] = await db
      .update(actionRequests)
      .set({ status: "failed", errorCode: failure.code, result: { message: failure.message } })
      .where(and(eq(actionRequests.id, requestId), eq(actionRequests.status, "approved")))
      .returning({ organizationId: actionRequests.organizationId });
    if (failed) {
      await recordAudit(db, {
        actorType: "user",
        actorUserId: approver.userId,
        organizationId: failed.organizationId,
        action: "action.execute",
        targetType: "action_request",
        targetId: requestId,
        outcome: "failed",
        correlationId: options.correlationId,
        metadata: { code: failure.code },
      });
    }
    return { status: "failed" as const, error: failure };
  }
}
