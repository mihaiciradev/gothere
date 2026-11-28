import { desc, sql } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/client";
import { auditRecords } from "@/infrastructure/db/schema";
import { type Actor, requirePlatformAdminById } from "@/modules/identity";

/** Control Center read models. Platform admins only; nothing here writes. */

export async function healthSnapshot(db: DbExecutor, actor: Actor) {
  await requirePlatformAdminById(db, actor.userId);
  const started = performance.now();
  await db.execute(sql`SELECT 1`);
  const dbLatencyMs = Math.round(performance.now() - started);
  const result = await db.execute<{
      queued: number; running: number; dead_24h: number; due: number; overdue_holds: number; active_holds: number;
      pending_payments: number; refunds_required: number; orders_24h: number; incidents_open: number; p0: number; p1: number; p2: number; p3: number; simulated_open: number;
    }>(sql`
      SELECT
        (SELECT count(*) FROM jobs WHERE status = 'queued')::int AS queued,
        (SELECT count(*) FROM jobs WHERE status = 'running')::int AS running,
        (SELECT count(*) FROM jobs WHERE status = 'dead' AND updated_at > now() - interval '24 hours' AND type NOT LIKE 'test.%')::int AS dead_24h,
        (SELECT count(*) FROM jobs WHERE status = 'queued' AND run_at <= now())::int AS due,
        (SELECT count(*) FROM reservations WHERE status = 'active' AND expires_at <= now())::int AS overdue_holds,
        (SELECT count(*) FROM reservations WHERE status = 'active')::int AS active_holds,
        (SELECT count(*) FROM payment_attempts WHERE status IN ('initiated', 'pending', 'unknown'))::int AS pending_payments,
        (SELECT count(*) FROM payment_attempts WHERE disposition = 'refund_required')::int AS refunds_required,
        (SELECT count(*) FROM orders WHERE confirmed_at > now() - interval '24 hours' AND origin = 'live')::int AS orders_24h,
        (SELECT count(*) FROM incidents WHERE status <> 'resolved' AND origin = 'live')::int AS incidents_open,
        (SELECT count(*) FROM incidents WHERE status <> 'resolved' AND origin = 'live' AND severity = 'P0')::int AS p0,
        (SELECT count(*) FROM incidents WHERE status <> 'resolved' AND origin = 'live' AND severity = 'P1')::int AS p1,
        (SELECT count(*) FROM incidents WHERE status <> 'resolved' AND origin = 'live' AND severity = 'P2')::int AS p2,
        (SELECT count(*) FROM incidents WHERE status <> 'resolved' AND origin = 'live' AND severity = 'P3')::int AS p3,
        (SELECT count(*) FROM incidents WHERE status <> 'resolved' AND origin = 'simulated')::int AS simulated_open`);
  return { dbLatencyMs, ...result.rows[0]! };
}

export async function recentTransactions(db: DbExecutor, actor: Actor, limit = 40) {
  await requirePlatformAdminById(db, actor.userId);
  const attempts = await db.execute<{
    id: string; status: string; disposition: string; amount_minor: number; currency: string; created_at: Date; reservation_id: string;
    reservation_status: string; event_title: string; order_id: string | null; origin: string;
  }>(sql`
    SELECT pa.id, pa.status, pa.disposition, pa.amount_minor, pa.currency, pa.created_at, pa.reservation_id,
           r.status AS reservation_status, e.title AS event_title, o.id AS order_id, r.origin
    FROM payment_attempts pa
    JOIN reservations r ON r.id = pa.reservation_id
    JOIN events e ON e.id = r.event_id
    LEFT JOIN orders o ON o.payment_attempt_id = pa.id
    ORDER BY pa.created_at DESC LIMIT ${limit}`);
  const totals = await db.execute<{ origin: string; orders: number; gross_minor: number; refunds_required: number; refunded: number }>(sql`
    SELECT r.origin,
      count(o.id)::int AS orders, coalesce(sum(o.total_minor), 0)::int AS gross_minor,
      count(*) FILTER (WHERE pa.disposition = 'refund_required')::int AS refunds_required,
      count(*) FILTER (WHERE pa.disposition = 'refunded')::int AS refunded
    FROM payment_attempts pa JOIN reservations r ON r.id = pa.reservation_id LEFT JOIN orders o ON o.payment_attempt_id = pa.id
    WHERE pa.created_at > now() - interval '30 days'
    GROUP BY r.origin`);
  return { attempts: attempts.rows, totals: totals.rows };
}

export async function aiUsageSummary(db: DbExecutor, actor: Actor) {
  await requirePlatformAdminById(db, actor.userId);
  const [byFeature, byDay, recent] = await Promise.all([
    db.execute<{ feature: string; status: string; calls: number; input_tokens: number; output_tokens: number; cost_micro_usd: number }>(sql`
      SELECT feature, status::text, count(*)::int AS calls, coalesce(sum(input_tokens), 0)::int AS input_tokens,
             coalesce(sum(output_tokens), 0)::int AS output_tokens, coalesce(sum(cost_micro_usd), 0)::int AS cost_micro_usd
      FROM ai_usage_records WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'
      GROUP BY feature, status ORDER BY feature, status`),
    db.execute<{ day: string; calls: number; cost_micro_usd: number }>(sql`
      SELECT to_char(created_at AT TIME ZONE 'utc', 'YYYY-MM-DD') AS day, count(*)::int AS calls, coalesce(sum(cost_micro_usd), 0)::int AS cost_micro_usd
      FROM ai_usage_records WHERE created_at > now() - interval '14 days' GROUP BY 1 ORDER BY 1`),
    db.execute<{ id: string; created_at: Date; feature: string; model: string; status: string; input_tokens: number; output_tokens: number; cost_micro_usd: number; latency_ms: number; error_code: string | null }>(sql`
      SELECT id, created_at, feature, model, status::text, input_tokens, output_tokens, cost_micro_usd, latency_ms, error_code
      FROM ai_usage_records ORDER BY created_at DESC LIMIT 30`),
  ]);
  return { byFeature: byFeature.rows, byDay: byDay.rows, recent: recent.rows };
}

export async function recentAudit(db: DbExecutor, actor: Actor, limit = 25) {
  await requirePlatformAdminById(db, actor.userId);
  return db.select().from(auditRecords).orderBy(desc(auditRecords.occurredAt)).limit(limit);
}
