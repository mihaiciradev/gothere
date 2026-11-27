import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/infrastructure/db/client";
import { paymentAttempts, paymentProviderEvents } from "@/infrastructure/db/schema";
import { logger } from "@/infrastructure/logging/logger";
import { recordAudit } from "@/modules/audit";
import { enqueueJob } from "@/modules/operations";
import { closeReservation, getReservationLines, lockReservation } from "@/modules/reservations";
import { confirmOrder } from "@/modules/ticketing";
import { decideSuccess, interpretNotification } from "./domain/state";
import type { ProviderPayment } from "./provider";

export const REFUND_JOB = "payments.simulated_refund";

export type ProviderEventInput = Readonly<{
  providerEventId: string;
  source: "webhook" | "sync" | "reconciliation";
  payment: ProviderPayment;
}>;

/**
 * Step 1, own transaction: durably record what the provider told us. Deduplicated by provider event id.
 * Nothing that happens during processing can make this record disappear, so every provider success
 * stays visible to reconciliation even if acceptance fails or is rejected.
 */
export async function recordProviderEvent(db: Database, input: ProviderEventInput): Promise<string> {
  const [inserted] = await db
    .insert(paymentProviderEvents)
    .values({
      provider: "simulator",
      providerEventId: input.providerEventId,
      providerReference: input.payment.providerReference,
      type: "payment.updated",
      payload: { source: input.source, ...input.payment },
    })
    .onConflictDoNothing({ target: [paymentProviderEvents.provider, paymentProviderEvents.providerEventId] })
    .returning({ id: paymentProviderEvents.id });
  if (inserted) return inserted.id;
  const [existing] = await db
    .select({ id: paymentProviderEvents.id })
    .from(paymentProviderEvents)
    .where(and(eq(paymentProviderEvents.provider, "simulator"), eq(paymentProviderEvents.providerEventId, input.providerEventId)));
  return existing!.id;
}

export type ProcessingOutcome =
  | "already_processed"
  | "orphan"
  | "reference_mismatch"
  | "ignored_duplicate"
  | "ignored_stale"
  | "recorded_pending"
  | "recorded_failed"
  | "accepted"
  | "refund_required:late_success"
  | "refund_required:duplicate_success"
  | "refund_required:amount_mismatch";

/**
 * Step 2, one transaction: apply a recorded provider event. Lock order: event → reservation → attempt →
 * inventory (sorted). Acceptance, order, tickets and inventory commit happen atomically or not at all.
 */
export async function processProviderEvent(db: Database, eventRowId: string): Promise<ProcessingOutcome> {
  return db.transaction(async (tx) => {
    const [event] = await tx.select().from(paymentProviderEvents).where(eq(paymentProviderEvents.id, eventRowId)).for("update");
    if (!event) throw new Error(`provider event ${eventRowId} not found`);
    if (event.processedAt) return "already_processed";

    const data = event.payload as unknown as ProviderPayment;
    const finish = async (outcome: ProcessingOutcome, attemptId: string | null = null) => {
      await tx
        .update(paymentProviderEvents)
        .set({ processedAt: sql`now()`, outcome, paymentAttemptId: attemptId })
        .where(eq(paymentProviderEvents.id, eventRowId));
      return outcome;
    };

    const [attemptRef] = await tx
      .select({ id: paymentAttempts.id, reservationId: paymentAttempts.reservationId })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, data.merchantReference));
    if (!attemptRef) {
      logger.error("provider event for unknown payment attempt", { providerReference: data.providerReference });
      return finish("orphan");
    }

    const reservation = await lockReservation(tx, attemptRef.reservationId);
    const [attempt] = await tx.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptRef.id)).for("update");
    if (!reservation || !attempt) throw new Error("payment attempt or reservation vanished");

    if (attempt.providerReference && attempt.providerReference !== data.providerReference) {
      logger.error("provider reference mismatch", { attemptId: attempt.id });
      return finish("reference_mismatch", attempt.id);
    }

    const effect = interpretNotification(attempt.status, data.status);
    if (effect.kind === "ignore") {
      return finish(effect.reason === "duplicate" ? "ignored_duplicate" : "ignored_stale", attempt.id);
    }

    await tx
      .update(paymentAttempts)
      .set({
        status: effect.status,
        providerReference: data.providerReference,
        failureCode: effect.status === "failed" ? (data.failureCode ?? "provider_declined") : null,
        completedAt: effect.status === "pending" ? null : sql`now()`,
      })
      .where(eq(paymentAttempts.id, attempt.id));

    if (effect.status !== "succeeded") return finish(`recorded_${effect.status}`, attempt.id);

    const decision = decideSuccess({
      reservationStatus: reservation.status,
      reservationOverdue: reservation.overdue,
      amountMatches: data.amountMinor === attempt.amountMinor && data.currency === attempt.currency,
    });
    const auditBase = {
      actorType: "system" as const,
      organizationId: reservation.organizationId,
      targetType: "payment_attempt",
      targetId: attempt.id,
    };

    if (decision.kind === "accept") {
      await closeReservation(tx, reservation.id, "converted");
      const order = await confirmOrder(tx, {
        reservation,
        paymentAttemptId: attempt.id,
        lines: await getReservationLines(tx, reservation.id),
        origin: reservation.origin,
      });
      await tx.update(paymentAttempts).set({ disposition: "accepted" }).where(eq(paymentAttempts.id, attempt.id));
      await recordAudit(tx, {
        ...auditBase,
        action: "payment.accepted",
        outcome: "succeeded",
        metadata: { orderId: order.id, reservationId: reservation.id, amountMinor: attempt.amountMinor },
      });
      return finish("accepted", attempt.id);
    }

    if (decision.expireReservation) await closeReservation(tx, reservation.id, "expired");
    await tx.update(paymentAttempts).set({ disposition: "refund_required" }).where(eq(paymentAttempts.id, attempt.id));
    await enqueueJob(tx, { type: REFUND_JOB, payload: { attemptId: attempt.id }, dedupeKey: `refund:${attempt.id}` });
    await recordAudit(tx, {
      ...auditBase,
      action: "payment.refund_required",
      outcome: "succeeded",
      metadata: { reason: decision.reason, reservationId: reservation.id, reservationStatus: reservation.status },
    });
    return finish(`refund_required:${decision.reason}`, attempt.id);
  });
}

/** Record, then process. A processing failure leaves the event unprocessed for the reconciliation job. */
export async function ingestProviderEvent(db: Database, input: ProviderEventInput): Promise<ProcessingOutcome | "deferred"> {
  const eventRowId = await recordProviderEvent(db, input);
  try {
    return await processProviderEvent(db, eventRowId);
  } catch (error) {
    logger.error("provider event processing deferred", { error, eventRowId });
    return "deferred";
  }
}
