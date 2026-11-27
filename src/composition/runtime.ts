import { type Database, getDb } from "@/infrastructure/db/client";
import { serverEnv, simulatorScenariosEnabled } from "@/infrastructure/env";
import { type JobHandlers, type RunSummary, runDueJobs } from "@/modules/operations";
import {
  type PaymentDeps,
  RECONCILE_ATTEMPT_JOB,
  REFUND_JOB,
  SIMULATOR_DELIVERY_JOB,
  createSimulatorProvider,
  deliverSimulatorNotification,
  processSimulatedRefund,
  reconcileAttempt,
  reconcilePayments,
} from "@/modules/payments";
import { sweepOverdueReservations } from "@/modules/reservations";

/** Composition root: the only place that binds modules to configuration and to each other's job types. */

export function paymentDeps(db: Database = getDb()): PaymentDeps {
  return { provider: createSimulatorProvider(db), allowScenarios: simulatorScenariosEnabled(serverEnv()) };
}

export function jobHandlers(db: Database, webhookSecret: string): JobHandlers {
  const provider = createSimulatorProvider(db);
  return {
    [SIMULATOR_DELIVERY_JOB]: (payload) => deliverSimulatorNotification(db, webhookSecret, payload),
    [REFUND_JOB]: async (payload) => {
      await processSimulatedRefund(db, provider, String(payload.attemptId));
    },
    [RECONCILE_ATTEMPT_JOB]: async (payload) => {
      const result = await reconcileAttempt(db, provider, String(payload.attemptId));
      if (result === "unresolved") throw new Error("payment attempt still unresolved; retrying with backoff");
    },
  };
}

export type OperationsCycle = RunSummary & { expiredReservations: number; payments: Awaited<ReturnType<typeof reconcilePayments>> };

/**
 * One maintenance pass: expire overdue reservations, reconcile payments, run due jobs. Triggered by Vercel
 * Cron, the protected manual endpoint and opportunistically after requests. Correctness never depends on it:
 * expiry is also enforced at read and payment time.
 */
export async function runOperationsCycle(db: Database = getDb(), options: { jobLimit?: number } = {}): Promise<OperationsCycle> {
  const expiredReservations = await sweepOverdueReservations(db, { limit: 200 });
  const payments = await reconcilePayments(db, createSimulatorProvider(db));
  const jobs = await runDueJobs(db, jobHandlers(db, serverEnv().PAYMENT_WEBHOOK_SECRET), { limit: options.jobLimit ?? 25 });
  return { ...jobs, expiredReservations, payments };
}
