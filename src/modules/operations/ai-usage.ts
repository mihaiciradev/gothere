import { and, desc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/client";
import { aiUsageRecords } from "@/infrastructure/db/schema";

export type AiUsageEntry = typeof aiUsageRecords.$inferInsert;

/** One row per provider call or budget refusal. Never contains prompt or response content. */
export async function recordAiUsage(db: DbExecutor, entry: AiUsageEntry): Promise<void> {
  await db.insert(aiUsageRecords).values(entry);
}

const monthToDate = sql`created_at >= date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'`;

/**
 * Spend in the current UTC calendar month, in micro-USD (database clock). Includes open reservations: money that
 * may already be committed at the provider counts until it is settled.
 */
export async function aiSpendThisMonth(db: DbExecutor): Promise<number> {
  const result = await db.execute<{ spend: string }>(sql`
    SELECT coalesce(sum(cost_micro_usd), 0)::bigint AS spend FROM ai_usage_records WHERE ${monthToDate}`);
  return Number(result.rows[0]?.spend ?? 0);
}

export type AiReservation = { id: string; reservedMicroUsd: number };

/**
 * Atomically reserves the worst-case cost of one provider call against the monthly budget. A transaction-scoped
 * advisory lock serialises reservations (across instances, since the lock lives in PostgreSQL), so concurrent
 * requests can never jointly exceed the budget: either the whole worst case fits and is recorded as `reserved`, or
 * nothing is reserved and the call must not be made. Returns null when it does not fit.
 */
export async function reserveAiBudget(
  db: DbExecutor,
  entry: Omit<AiUsageEntry, "status" | "costMicroUsd"> & { reserveMicroUsd: number },
  monthlyBudgetMicroUsd: number,
): Promise<AiReservation | null> {
  const { reserveMicroUsd, ...fields } = entry;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('gothere.ai_budget'))`);
    if ((await aiSpendThisMonth(tx)) + reserveMicroUsd > monthlyBudgetMicroUsd) return null;
    const [row] = await tx
      .insert(aiUsageRecords)
      .values({ ...fields, status: "reserved", costMicroUsd: reserveMicroUsd })
      .returning({ id: aiUsageRecords.id });
    return { id: row!.id, reservedMicroUsd: reserveMicroUsd };
  });
}

/** Replaces a reservation with the call's real outcome and cost. Only an open reservation can be settled. */
export async function settleAiUsage(
  db: DbExecutor,
  reservationId: string,
  outcome: Pick<AiUsageEntry, "status" | "inputTokens" | "outputTokens" | "costMicroUsd" | "latencyMs" | "errorCode">,
): Promise<void> {
  await db
    .update(aiUsageRecords)
    .set(outcome)
    .where(and(eq(aiUsageRecords.id, reservationId), eq(aiUsageRecords.status, "reserved")));
}

export async function recentAiUsage(db: DbExecutor, limit = 50) {
  return db.select().from(aiUsageRecords).orderBy(desc(aiUsageRecords.createdAt)).limit(limit);
}
