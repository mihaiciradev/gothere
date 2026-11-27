import { eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { jobs } from "@/infrastructure/db/schema";
import { claimJobs, completeJob, enqueueJob, runDueJobs } from "@/modules/operations";
import { openTestDatabase } from "./support/fixtures";

const { db, pool } = openTestDatabase(15);
afterAll(async () => {
  // Leave no fake job types behind for later suites (e2e runs a real worker on this database).
  await db.delete(jobs).where(like(jobs.type, "test.%"));
  await pool.end();
});

/** Each test uses its own job type so jobs from other test files never interfere. */
const jobType = () => `test.${crypto.randomUUID()}`;

async function enqueueMany(type: string, count: number, maxAttempts = 5) {
  for (let i = 0; i < count; i++) await enqueueJob(db, { type, payload: { n: i }, maxAttempts });
  return db.select().from(jobs).where(eq(jobs.type, type));
}

async function jobRows(type: string) {
  return db.select().from(jobs).where(eq(jobs.type, type));
}

async function claimOnly(type: string, workerId: string, leaseSeconds = 60) {
  // Isolate the claim to this test's jobs by pausing everyone else's for the duration of the call.
  await db.update(jobs).set({ runAt: sql`now() + interval '1 hour'` }).where(sql`${jobs.type} <> ${type} AND ${jobs.status} = 'queued'`);
  return claimJobs(db, workerId, 100, leaseSeconds);
}

describe("durable jobs", () => {
  it("concurrent workers never claim the same job twice", async () => {
    const type = jobType();
    await enqueueMany(type, 30);
    await db.update(jobs).set({ runAt: sql`now() + interval '1 hour'` }).where(sql`${jobs.type} <> ${type} AND ${jobs.status} = 'queued'`);

    const claims = await Promise.all(Array.from({ length: 6 }, (_, i) => claimJobs(db, `worker-${i}`, 10, 60)));
    const ids = claims.flat().map((j) => j.id);
    expect(ids).toHaveLength(30);
    expect(new Set(ids).size).toBe(30);
  });

  it("recovers a job whose worker crashed, and fences out the stale worker", async () => {
    const type = jobType();
    const [job] = await enqueueMany(type, 1);
    const crashed = await claimOnly(type, "crashed-worker", 30);
    expect(crashed.map((j) => j.id)).toContain(job!.id);

    // The crashed worker never completes; its lease runs out.
    await db.update(jobs).set({ lockedUntil: sql`now() - interval '1 second'` }).where(eq(jobs.id, job!.id));

    const executions: string[] = [];
    const summary = await runDueJobs(db, { [type]: async (_p, ctx) => void executions.push(ctx.jobId) }, { workerId: "rescuer" });
    expect(summary.succeeded).toBeGreaterThanOrEqual(1);
    expect(executions).toEqual([job!.id]);

    const [after] = await jobRows(type);
    expect(after).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(await completeJob(db, job!.id, "crashed-worker")).toBe(false);
  });

  it("retries failures with backoff and stops after max attempts", async () => {
    const type = jobType();
    const [job] = await enqueueMany(type, 1, 2);
    const failing = { [type]: async () => Promise.reject(new Error("boom")) };

    await db.update(jobs).set({ runAt: sql`now() + interval '1 hour'` }).where(sql`${jobs.type} <> ${type} AND ${jobs.status} = 'queued'`);
    await runDueJobs(db, failing);
    let [row] = await jobRows(type);
    expect(row).toMatchObject({ status: "queued", attempts: 1, lastError: "boom" });
    expect(row!.runAt.getTime()).toBeGreaterThan(Date.now());

    await db.update(jobs).set({ runAt: sql`now()` }).where(eq(jobs.id, job!.id));
    await runDueJobs(db, failing);
    [row] = await jobRows(type);
    expect(row).toMatchObject({ status: "dead", attempts: 2 });
  });

  it("buries a job whose final attempt crashed instead of running it again", async () => {
    const type = jobType();
    const [job] = await enqueueMany(type, 1, 1);
    await claimOnly(type, "crashed-worker", 30);
    await db.update(jobs).set({ lockedUntil: sql`now() - interval '1 second'` }).where(eq(jobs.id, job!.id));

    let ran = false;
    await runDueJobs(db, { [type]: async () => void (ran = true) });
    expect(ran).toBe(false);
    expect((await jobRows(type))[0]).toMatchObject({ status: "dead" });
  });

  it("deduplicates jobs by key", async () => {
    const type = jobType();
    const dedupeKey = `dedupe-${crypto.randomUUID()}`;
    await Promise.all(Array.from({ length: 5 }, () => enqueueJob(db, { type, dedupeKey })));
    expect(await jobRows(type)).toHaveLength(1);
  });

  it("enqueued jobs roll back with the transaction that created them", async () => {
    const type = jobType();
    await db
      .transaction(async (tx) => {
        await enqueueJob(tx, { type });
        throw new Error("rollback");
      })
      .catch(() => undefined);
    expect(await db.select().from(jobs).where(inArray(jobs.type, [type]))).toHaveLength(0);
  });
});
