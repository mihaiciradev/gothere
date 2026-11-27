import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "@/infrastructure/db/client";
import { paymentAttempts, paymentProviderEvents } from "@/infrastructure/db/schema";
import { recordAudit } from "@/modules/audit";
import { ingestProviderEvent, processProviderEvent } from "./processing";
import { verifyFailureLater } from "./service";
import type { PaymentProvider } from "./provider";

export type ReconcileResult = "settled" | "unresolved" | "not_found_at_provider";

/**
 * Asks the provider what really happened to an attempt and feeds the answer through the normal
 * processing pipeline. Used for timeouts, lost webhooks and attempts stuck after a crash.
 */
export async function reconcileAttempt(db: Database, provider: PaymentProvider, attemptId: string): Promise<ReconcileResult> {
  const [attempt] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId));
  // Failed attempts are checked too: a provider success after a failure must still be accounted for.
  if (!attempt || attempt.status === "succeeded") return "settled";

  const payment = await provider.getPayment(attempt.id);
  if (!payment && attempt.status === "failed") return "settled";
  if (!payment) {
    // The provider never received it: safe to fail, the attendee can retry.
    const failed = await db.transaction(async (tx) => {
      const rows = await tx
      .update(paymentAttempts)
      .set({ status: "failed", failureCode: "not_received_by_provider", completedAt: sql`now()` })
      .where(
        and(
          eq(paymentAttempts.id, attempt.id),
          or(eq(paymentAttempts.status, "unknown"), and(eq(paymentAttempts.status, "initiated"), lt(paymentAttempts.createdAt, sql`now() - interval '1 minute'`))),
        ),
      )
      .returning({ id: paymentAttempts.id });
      if (rows.length) await verifyFailureLater(tx, attempt.id);
      return rows;
    });
    return failed.length ? "not_found_at_provider" : "unresolved";
  }

  await ingestProviderEvent(db, {
    providerEventId: `reconcile_${payment.providerReference}_${payment.status}`,
    source: "reconciliation",
    payment,
  });
  const [after] = await db.select({ status: paymentAttempts.status }).from(paymentAttempts).where(eq(paymentAttempts.id, attempt.id));
  return after?.status === "succeeded" || after?.status === "failed" ? "settled" : "unresolved";
}

/** Periodic sweep: unprocessed provider events, unknown attempts and attempts stuck in flight. */
export async function reconcilePayments(db: Database, provider: PaymentProvider, limit = 50) {
  const events = await db
    .select({ id: paymentProviderEvents.id })
    .from(paymentProviderEvents)
    .where(and(isNull(paymentProviderEvents.processedAt), lt(paymentProviderEvents.receivedAt, sql`now() - interval '30 seconds'`)))
    .limit(limit);
  for (const { id } of events) await processProviderEvent(db, id);

  const stuck = await db
    .select({ id: paymentAttempts.id })
    .from(paymentAttempts)
    .where(
      or(
        eq(paymentAttempts.status, "unknown"),
        and(eq(paymentAttempts.status, "initiated"), lt(paymentAttempts.createdAt, sql`now() - interval '2 minutes'`)),
        and(eq(paymentAttempts.status, "pending"), lt(paymentAttempts.updatedAt, sql`now() - interval '10 minutes'`)),
      ),
    )
    .limit(limit);
  const results = [];
  for (const { id } of stuck) results.push(await reconcileAttempt(db, provider, id));
  return { eventsReprocessed: events.length, attemptsChecked: stuck.length, settled: results.filter((r) => r !== "unresolved").length };
}

export type UnreconciledSuccess = {
  providerReference: string;
  paymentAttemptId: string | null;
  outcome: string | null;
  amountMinor: number;
  currency: string;
  receivedAt: Date;
};

/**
 * Financial reconciliation report: every provider-reported success must end as an attempt that is
 * `succeeded` with a decision (accepted, refund_required or refunded) under the same provider reference.
 * Anything returned here is money the provider holds that the application has not accounted for
 * (unprocessed events, orphans, reference mismatches). Expected to be empty in normal operation.
 */
export async function findUnreconciledProviderSuccesses(db: Database): Promise<UnreconciledSuccess[]> {
  const result = await db.execute<{
    provider_reference: string;
    payment_attempt_id: string | null;
    outcome: string | null;
    amount_minor: number;
    currency: string;
    received_at: Date;
  }>(sql`
    SELECT DISTINCT ON (e.provider_reference)
      e.provider_reference, a.id AS payment_attempt_id, e.outcome,
      (e.payload->>'amountMinor')::int AS amount_minor, e.payload->>'currency' AS currency, e.received_at
    FROM payment_provider_events e
    LEFT JOIN payment_attempts a ON a.id::text = e.payload->>'merchantReference'
    WHERE e.payload->>'status' = 'succeeded'
      AND NOT coalesce(
        a.status = 'succeeded' AND a.disposition <> 'none' AND a.provider_reference = e.provider_reference,
        false)
    ORDER BY e.provider_reference, e.received_at DESC`);
  return result.rows.map((r) => ({
    providerReference: r.provider_reference,
    paymentAttemptId: r.payment_attempt_id,
    outcome: r.outcome,
    amountMinor: r.amount_minor,
    currency: r.currency,
    receivedAt: new Date(r.received_at),
  }));
}

/**
 * Simulated refund of a provider success that was not accepted. Calls the simulator outside any
 * transaction, then records the disposition. Idempotent: refunding twice is a no-op on both sides.
 */
export async function processSimulatedRefund(db: Database, provider: PaymentProvider, attemptId: string): Promise<boolean> {
  const [attempt] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId));
  if (!attempt || attempt.disposition !== "refund_required" || !attempt.providerReference) return false;

  await provider.refund(attempt.providerReference);
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(paymentAttempts)
      .set({ disposition: "refunded" })
      .where(and(eq(paymentAttempts.id, attemptId), inArray(paymentAttempts.disposition, ["refund_required"])))
      .returning({ id: paymentAttempts.id });
    if (updated.length === 0) return false;
    await recordAudit(tx, {
      actorType: "system",
      action: "payment.refunded_simulated",
      targetType: "payment_attempt",
      targetId: attemptId,
      outcome: "succeeded",
      metadata: { amountMinor: attempt.amountMinor, currency: attempt.currency, simulated: true },
    });
    return true;
  });
}
