import { type Database, getDb } from "@/infrastructure/db/client";
import { serverEnv, simulatorScenariosEnabled } from "@/infrastructure/env";
import { logger } from "@/infrastructure/logging/logger";
import { detectAnomalies, reportReservationExpiryFailure, reportStageFailure } from "@/modules/incidents";
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

export type OperationsCycle = {
  expiredReservations: number | null;
  payments: Awaited<ReturnType<typeof reconcilePayments>> | null;
  jobs: RunSummary | null;
  /** New operational events recorded by the anomaly detectors in this pass. */
  anomalies: number | null;
  /** Stages that threw; the others still ran. */
  failedStages: string[];
};

/**
 * One maintenance pass: expire overdue reservations, reconcile payments, run due jobs. Triggered by Vercel
 * Cron, the protected manual endpoint and opportunistically after requests. Correctness never depends on it:
 * expiry is also enforced at read and payment time. Stages are independent: a failure in one is logged and the
 * others still run, so one bad row can never stop payment confirmations or refunds.
 */
export async function runOperationsCycle(db: Database = getDb(), options: { jobLimit?: number } = {}): Promise<OperationsCycle> {
  const failedStages: string[] = [];
  const stage = async <T>(name: string, run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (error) {
      failedStages.push(name);
      logger.error("operations stage failed", { stage: name, error });
      await reportStageFailure(db, name, error);
      return null;
    }
  };
  const expiredReservations = await stage("reservations.sweep", () =>
    sweepOverdueReservations(db, { limit: 200, onFailure: (id, error) => reportReservationExpiryFailure(db, id, error) }),
  );
  const payments = await stage("payments.reconcile", () => reconcilePayments(db, createSimulatorProvider(db)));
  const jobs = await stage("jobs.run", () =>
    runDueJobs(db, jobHandlers(db, serverEnv().PAYMENT_WEBHOOK_SECRET), { limit: options.jobLimit ?? 25 }),
  );
  // Last: scan for conditions no request reports (counter drift, stuck provider successes, dead jobs).
  const anomalies = await stage("incidents.detect", () => detectAnomalies(db));
  return { expiredReservations, payments, jobs, anomalies, failedStages };
}
