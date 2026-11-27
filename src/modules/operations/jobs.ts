import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database, DbExecutor } from "@/infrastructure/db/client";
import { jobs } from "@/infrastructure/db/schema";
import { logger } from "@/infrastructure/logging/logger";
import { currentCorrelationId, runWithContext } from "@/infrastructure/request-context";

export type JobContext = Readonly<{ db: Database; jobId: string; attempt: number }>;
export type JobHandler = (payload: Record<string, unknown>, context: JobContext) => Promise<void>;
export type JobHandlers = Readonly<Record<string, JobHandler>>;

export type EnqueueJob = {
  type: string;
  payload?: Record<string, unknown>;
  delaySeconds?: number;
  maxAttempts?: number;
  /** Enqueueing an existing dedupe key is a no-op. */
  dedupeKey?: string;
};

/** Call inside the business transaction so the job commits (or rolls back) with the change: a transactional outbox. */
export async function enqueueJob(db: DbExecutor, job: EnqueueJob): Promise<void> {
  await db
    .insert(jobs)
    .values({
      type: job.type,
      payload: job.payload ?? {},
      runAt: sql`now() + make_interval(secs => ${job.delaySeconds ?? 0})`,
      maxAttempts: job.maxAttempts ?? 5,
      dedupeKey: job.dedupeKey,
      correlationId: currentCorrelationId(),
    })
    .onConflictDoNothing({ target: jobs.dedupeKey });
}

export type ClaimedJob = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  correlationId: string | null;
};

/**
 * Atomically claims due jobs. A running job whose lease expired (worker crashed or timed out) is
 * claimable again; FOR UPDATE SKIP LOCKED lets concurrent runners share the queue without double-claiming.
 */
export async function claimJobs(
  db: Database,
  workerId: string,
  limit: number,
  leaseSeconds: number,
): Promise<ClaimedJob[]> {
  const result = await db.execute<{
    id: string;
    type: string;
    payload: Record<string, unknown>;
    attempts: number;
    max_attempts: number;
    correlation_id: string | null;
  }>(sql`
    UPDATE jobs SET
      status = 'running',
      attempts = attempts + 1,
      locked_by = ${workerId},
      locked_until = now() + make_interval(secs => ${leaseSeconds}),
      updated_at = now()
    WHERE id IN (
      SELECT id FROM jobs
      WHERE attempts < max_attempts
        AND ((status = 'queued' AND run_at <= now()) OR (status = 'running' AND locked_until < now()))
      ORDER BY run_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, payload, attempts, max_attempts, correlation_id`);
  return result.rows.map((r) => ({
    id: r.id,
    type: r.type,
    payload: r.payload,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    correlationId: r.correlation_id,
  }));
}

/** A job whose final attempt lost its lease can never be claimed again; mark it dead so it is visible. */
export async function buryAbandonedJobs(db: Database): Promise<number> {
  const result = await db.execute(sql`
    UPDATE jobs SET status = 'dead', last_error = coalesce(last_error, 'lease expired on final attempt'),
      locked_by = NULL, locked_until = NULL, updated_at = now()
    WHERE status = 'running' AND locked_until < now() AND attempts >= max_attempts`);
  return result.rowCount ?? 0;
}

/** Fenced: only the worker that still holds the lease can complete the job. */
export async function completeJob(db: Database, jobId: string, workerId: string): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE jobs SET status = 'succeeded', completed_at = now(), locked_by = NULL, locked_until = NULL, updated_at = now()
    WHERE id = ${jobId} AND status = 'running' AND locked_by = ${workerId}`);
  return (result.rowCount ?? 0) === 1;
}

export function backoffSeconds(attempt: number): number {
  return Math.min(5 * 2 ** Math.max(attempt - 1, 0), 900);
}

export async function failJob(
  db: Database,
  job: ClaimedJob,
  workerId: string,
  error: unknown,
): Promise<"retry" | "dead" | "lost"> {
  const message = error instanceof Error ? error.message.slice(0, 1000) : "unknown error";
  const dead = job.attempts >= job.maxAttempts;
  const result = await db.execute(sql`
    UPDATE jobs SET
      status = ${dead ? "dead" : "queued"}::job_status,
      run_at = now() + make_interval(secs => ${backoffSeconds(job.attempts)}),
      last_error = ${message}, locked_by = NULL, locked_until = NULL, updated_at = now()
    WHERE id = ${job.id} AND status = 'running' AND locked_by = ${workerId}`);
  if ((result.rowCount ?? 0) === 0) return "lost";
  return dead ? "dead" : "retry";
}

export type RunSummary = { claimed: number; succeeded: number; retried: number; dead: number; lost: number };

export async function runDueJobs(
  db: Database,
  handlers: JobHandlers,
  options: { limit?: number; leaseSeconds?: number; workerId?: string } = {},
): Promise<RunSummary> {
  const workerId = options.workerId ?? `worker-${randomUUID()}`;
  const summary: RunSummary = { claimed: 0, succeeded: 0, retried: 0, dead: await buryAbandonedJobs(db), lost: 0 };
  const claimed = await claimJobs(db, workerId, options.limit ?? 20, options.leaseSeconds ?? 60);
  summary.claimed = claimed.length;

  for (const job of claimed) {
    const log = logger.child({ jobId: job.id, jobType: job.type, attempt: job.attempts });
    await runWithContext({ correlationId: job.correlationId ?? job.id }, async () => {
      try {
        const handler = handlers[job.type];
        if (!handler) throw new Error(`No handler registered for job type ${job.type}`);
        await handler(job.payload, { db, jobId: job.id, attempt: job.attempts });
        if (await completeJob(db, job.id, workerId)) summary.succeeded += 1;
        else {
          summary.lost += 1;
          log.warn("job lease lost before completion");
        }
      } catch (error) {
        const outcome = await failJob(db, job, workerId, error);
        if (outcome === "retry") summary.retried += 1;
        else if (outcome === "dead") summary.dead += 1;
        else summary.lost += 1;
        log.error("job failed", { error, outcome });
      }
    });
  }
  return summary;
}
