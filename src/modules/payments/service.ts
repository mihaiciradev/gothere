import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, DbExecutor } from "@/infrastructure/db/client";
import { paymentAttempts } from "@/infrastructure/db/schema";
import { logger } from "@/infrastructure/logging/logger";
import type { Actor } from "@/modules/identity";
import { enqueueJob } from "@/modules/operations";
import { closeReservation, idempotencyKeySchema, lockReservation } from "@/modules/reservations";
import { AppError } from "@/shared/errors";
import { ingestProviderEvent } from "./processing";
import {
  type PaymentProvider,
  ProviderTimeoutError,
  ProviderUnavailableError,
  simulatorScenarios,
} from "./provider";

export const RECONCILE_ATTEMPT_JOB = "payments.reconcile_attempt";

export const startPaymentSchema = z
  .object({ scenario: z.enum(simulatorScenarios).default("success") })
  .strict();

export type PaymentDeps = Readonly<{ provider: PaymentProvider; allowScenarios: boolean }>;

type AttemptRow = typeof paymentAttempts.$inferSelect;

export type PaymentAttemptView = {
  id: string;
  reservationId: string;
  status: AttemptRow["status"];
  disposition: AttemptRow["disposition"];
  amountMinor: number;
  currency: string;
  failureCode: string | null;
  simulated: true;
  createdAt: Date;
  completedAt: Date | null;
};

function toView(row: AttemptRow): PaymentAttemptView {
  return {
    id: row.id,
    reservationId: row.reservationId,
    status: row.status,
    disposition: row.disposition,
    amountMinor: row.amountMinor,
    currency: row.currency,
    failureCode: row.failureCode,
    simulated: true,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

async function readAttempt(db: DbExecutor, id: string): Promise<PaymentAttemptView> {
  const [row] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.id, id));
  return toView(row!);
}

export async function listPaymentAttempts(db: DbExecutor, reservationId: string): Promise<PaymentAttemptView[]> {
  const rows = await db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.reservationId, reservationId))
    .orderBy(asc(paymentAttempts.createdAt));
  return rows.map(toView);
}

/**
 * Starts a (simulated) payment for the actor's reservation.
 * 1. Transaction: verify ownership and state, create the attempt with the amount captured on the
 *    reservation (never from the client), commit.
 * 2. Call the provider with no transaction open.
 * 3. Record and process the outcome in new transactions; ambiguous outcomes go to reconciliation.
 */
export async function startPayment(
  db: Database,
  deps: PaymentDeps,
  actor: Actor,
  reservationId: string,
  input: unknown,
  options: { idempotencyKey: unknown },
): Promise<PaymentAttemptView> {
  const { scenario } = startPaymentSchema.parse(input ?? {});
  if (scenario !== "success" && !deps.allowScenarios) {
    throw new AppError("FORBIDDEN", "Payment simulator scenarios are disabled in this environment.");
  }
  const key = idempotencyKeySchema.parse(options.idempotencyKey);

  const prepared = await db.transaction(async (tx) => {
    const reservation = await lockReservation(tx, reservationId, actor.userId);
    if (!reservation) throw new AppError("NOT_FOUND", "Reservation not found.");

    const [previous] = await tx
      .select()
      .from(paymentAttempts)
      .where(and(eq(paymentAttempts.reservationId, reservationId), eq(paymentAttempts.idempotencyKey, key)));
    if (previous) return { kind: "replay" as const, attempt: previous };

    if (reservation.status === "converted") {
      throw new AppError("CONFLICT", "This reservation has already been paid.", { reason: "already_paid" });
    }
    if (reservation.status !== "active") {
      throw new AppError("PRECONDITION_FAILED", `This reservation is ${reservation.status}.`, { reason: "reservation_closed" });
    }
    if (reservation.overdue) {
      await closeReservation(tx, reservation.id, "expired");
      return { kind: "expired" as const };
    }

    const [attempt] = await tx
      .insert(paymentAttempts)
      .values({
        reservationId,
        idempotencyKey: key,
        amountMinor: reservation.totalMinor,
        currency: reservation.currency,
        status: "initiated",
      })
      .onConflictDoNothing()
      .returning();
    if (!attempt) return { kind: "in_progress" as const };
    return { kind: "created" as const, attempt };
  });

  if (prepared.kind === "expired") {
    throw new AppError("PRECONDITION_FAILED", "This reservation has expired.", { reason: "reservation_expired" });
  }
  if (prepared.kind === "in_progress") {
    throw new AppError("CONFLICT", "A payment for this reservation is already in progress.", { reason: "payment_in_progress" });
  }
  if (prepared.kind === "replay") return toView(prepared.attempt);

  const { attempt } = prepared;
  try {
    const payment = await deps.provider.createPayment({
      merchantReference: attempt.id,
      amountMinor: attempt.amountMinor,
      currency: attempt.currency,
      scenario,
    });
    await ingestProviderEvent(db, {
      providerEventId: `sync_${payment.providerReference}_${payment.status}`,
      source: "sync",
      payment,
    });
  } catch (error) {
    if (error instanceof ProviderUnavailableError) {
      await db
        .update(paymentAttempts)
        .set({ status: "failed", failureCode: "provider_unavailable", completedAt: sql`now()` })
        .where(and(eq(paymentAttempts.id, attempt.id), eq(paymentAttempts.status, "initiated")));
    } else {
      if (!(error instanceof ProviderTimeoutError)) logger.error("unexpected provider error", { error, attemptId: attempt.id });
      await db.transaction(async (tx) => {
        await tx
          .update(paymentAttempts)
          .set({ status: "unknown" })
          .where(and(eq(paymentAttempts.id, attempt.id), eq(paymentAttempts.status, "initiated")));
        await enqueueJob(tx, {
          type: RECONCILE_ATTEMPT_JOB,
          payload: { attemptId: attempt.id },
          delaySeconds: 10,
          maxAttempts: 8,
          dedupeKey: `reconcile:${attempt.id}`,
        });
      });
    }
  }
  return readAttempt(db, attempt.id);
}
