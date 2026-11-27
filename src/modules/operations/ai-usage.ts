import { desc, sql } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/client";
import { aiUsageRecords } from "@/infrastructure/db/schema";

export type AiUsageEntry = typeof aiUsageRecords.$inferInsert;

/** One row per provider call or budget refusal. Never contains prompt or response content. */
export async function recordAiUsage(db: DbExecutor, entry: AiUsageEntry): Promise<void> {
  await db.insert(aiUsageRecords).values(entry);
}

/** Spend in the current UTC calendar month, in micro-USD (database clock). */
export async function aiSpendThisMonth(db: DbExecutor): Promise<number> {
  const result = await db.execute<{ spend: string }>(sql`
    SELECT coalesce(sum(cost_micro_usd), 0)::bigint AS spend FROM ai_usage_records
    WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'`);
  return Number(result.rows[0]?.spend ?? 0);
}

export async function recentAiUsage(db: DbExecutor, limit = 50) {
  return db.select().from(aiUsageRecords).orderBy(desc(aiUsageRecords.createdAt)).limit(limit);
}
