import { sql } from "drizzle-orm";
import type { Database } from "@/infrastructure/db/client";
import { findUnreconciledProviderSuccesses } from "@/modules/payments";
import { sanitizeText } from "./domain/sanitize";
import { recordOperationalEvent } from "./recorder";

/** A provider success younger than this may simply still be processing; only older ones are anomalies. */
const UNRECONCILED_GRACE_MINUTES = 10;

/**
 * Read-only scans for conditions no single request reports: inventory counters that no longer cover their active
 * holds, provider successes left without an order or refund, and jobs that exhausted their retries. Each condition is
 * recorded once per dedupe key, so repeated scans do not inflate occurrences. Returns the number of new events.
 */
export async function detectAnomalies(db: Database): Promise<number> {
  let recorded = 0;
  const count = (r: unknown) => void (r && recorded++);
  const day = new Date().toISOString().slice(0, 10);

  const mismatches = await db.execute<{ id: string; name: string; reserved: number; held: number; price_minor: number; currency: string; event_id: string }>(sql`
    SELECT ii.id, ii.name, ii.reserved, h.held, ii.price_minor, ii.currency, ii.event_id
    FROM inventory_items ii
    JOIN (SELECT ri.inventory_item_id, sum(ri.quantity)::int AS held
          FROM reservations r JOIN reservation_items ri ON ri.reservation_id = r.id
          WHERE r.status = 'active' GROUP BY ri.inventory_item_id) h ON h.inventory_item_id = ii.id
    WHERE ii.reserved < h.held
    LIMIT 50`);
  for (const m of mismatches.rows) {
    count(
      await recordOperationalEvent(db, {
        kind: "inventory.counter_mismatch",
        message: `Reserved counter ${m.reserved} is below active holds ${m.held}.`,
        context: { inventoryItemId: m.id, itemName: m.name, eventId: m.event_id, reserved: m.reserved, activeHolds: m.held, missingUnits: m.held - m.reserved, unitPriceMinor: m.price_minor, currency: m.currency },
        fingerprintParts: [m.id],
        dedupeKey: `${m.id}:${day}`,
      }),
    );
  }

  const cutoff = Date.now() - UNRECONCILED_GRACE_MINUTES * 60_000;
  for (const u of (await findUnreconciledProviderSuccesses(db)).filter((x) => x.receivedAt.getTime() < cutoff).slice(0, 50)) {
    count(
      await recordOperationalEvent(db, {
        kind: "payments.unreconciled_success",
        message: `Provider success ${u.providerReference} has no accepted order or refund.`,
        context: { providerReference: u.providerReference, attemptId: u.paymentAttemptId, outcome: u.outcome, amountMinor: u.amountMinor, currency: u.currency },
        dedupeKey: u.providerReference,
      }),
    );
  }

  const dead = await db.execute<{ id: string; type: string; attempts: number; last_error: string | null; correlation_id: string | null; amount_minor: number | null; currency: string | null }>(sql`
    SELECT j.id, j.type, j.attempts, j.last_error, j.correlation_id, pa.amount_minor, pa.currency
    FROM jobs j
    LEFT JOIN payment_attempts pa ON pa.id::text = j.payload->>'attemptId'
    WHERE j.status = 'dead' AND j.type NOT LIKE 'test.%' AND j.updated_at > now() - interval '7 days'
    ORDER BY j.updated_at DESC LIMIT 50`);
  for (const j of dead.rows) {
    count(
      await recordOperationalEvent(db, {
        kind: "jobs.dead",
        message: `Job ${j.type} failed ${j.attempts} times: ${sanitizeText(j.last_error ?? "no error recorded", 200)}`,
        correlationId: j.correlation_id,
        context: { jobId: j.id, jobType: j.type, attempts: j.attempts, lastError: j.last_error, amountMinor: j.amount_minor, currency: j.currency },
        fingerprintParts: [j.type],
        dedupeKey: j.id,
      }),
    );
  }
  return recorded;
}
