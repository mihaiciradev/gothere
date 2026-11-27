import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { jobHandlers } from "@/composition/runtime";
import { jobs, orders, paymentAttempts, simulatorPayments } from "@/infrastructure/db/schema";
import type { Actor } from "@/modules/identity";
import { runDueJobs } from "@/modules/operations";
import {
  buildNotification,
  findUnreconciledProviderSuccesses,
  handleProviderNotification,
  signNotification,
  startPayment,
} from "@/modules/payments";
import { createReservation } from "@/modules/reservations";
import { createActor, createSellableEvent, expectAppError, key, openTestDatabase, simulatorDeps } from "./support/fixtures";
import { sql } from "drizzle-orm";

const { db, pool } = openTestDatabase(10);
afterAll(() => pool.end());

const secret = process.env.PAYMENT_WEBHOOK_SECRET!;
const deps = simulatorDeps(db);

async function setup() {
  const { event, admission } = await createSellableEvent(db, 10);
  const buyer = await createActor(db);
  const reservation = await createReservation(
    db,
    buyer,
    { eventId: event.id, items: [{ inventoryItemId: admission.id, quantity: 1 }] },
    { idempotencyKey: key() },
  );
  return { buyer, reservation };
}

const pay = (actor: Actor, reservationId: string, scenario = "success", idempotencyKey = key()) =>
  startPayment(db, deps, actor, reservationId, { scenario }, { idempotencyKey });

async function attempt(id: string) {
  const [row] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.id, id));
  return row!;
}

async function drainJobs() {
  for (let i = 0; i < 5; i++) {
    await db.update(jobs).set({ runAt: sql`now()` }).where(eq(jobs.status, "queued"));
    if ((await runDueJobs(db, jobHandlers(db, secret), { limit: 100 })).claimed === 0) return;
  }
}

/** The provider changes its mind: a payment it reported as failed later succeeds. */
async function providerLaterSucceeds(attemptId: string) {
  const [ledger] = await db.select().from(simulatorPayments).where(eq(simulatorPayments.merchantReference, attemptId));
  const a = await attempt(attemptId);
  const body = JSON.stringify(
    buildNotification(
      { providerReference: ledger!.providerReference, merchantReference: attemptId, status: "succeeded", amountMinor: a.amountMinor, currency: a.currency },
      "late-capture",
    ),
  );
  await db.update(simulatorPayments).set({ status: "succeeded" }).where(eq(simulatorPayments.merchantReference, attemptId));
  return handleProviderNotification(db, secret, body, signNotification(secret, body));
}

describe("provider success after a failed attempt", () => {
  it("is accepted when the reservation is still payable", async () => {
    const { buyer, reservation } = await setup();
    const declined = await pay(buyer, reservation.id, "decline");
    expect(declined.status).toBe("failed");

    expect(await providerLaterSucceeds(declined.id)).toBe("accepted");
    expect(await attempt(declined.id)).toMatchObject({ status: "succeeded", disposition: "accepted", failureCode: null });
    expect(await db.select().from(orders).where(eq(orders.reservationId, reservation.id))).toHaveLength(1);
  });

  it("is refunded when a retry was already accepted", async () => {
    const { buyer, reservation } = await setup();
    const declined = await pay(buyer, reservation.id, "decline");
    expect((await pay(buyer, reservation.id)).disposition).toBe("accepted");

    expect(await providerLaterSucceeds(declined.id)).toBe("refund_required:duplicate_success");
    await drainJobs();
    expect(await attempt(declined.id)).toMatchObject({ status: "succeeded", disposition: "refunded" });
    expect(await db.select().from(orders).where(eq(orders.reservationId, reservation.id))).toHaveLength(1);
  });

  it("is discovered by reconciliation when we marked the attempt failed ourselves", async () => {
    const { buyer, reservation } = await setup();
    const unavailable = await pay(buyer, reservation.id, "unavailable");
    expect(unavailable).toMatchObject({ status: "failed", failureCode: "provider_unavailable" });

    // The provider did in fact take the payment although it answered 503.
    await db.insert(simulatorPayments).values({
      providerReference: `sim_hidden_${unavailable.id.slice(0, 8)}`,
      merchantReference: unavailable.id,
      amountMinor: unavailable.amountMinor,
      currency: unavailable.currency,
      status: "succeeded",
      scenario: "unavailable",
    });

    await drainJobs(); // the verification job scheduled at failure time asks the provider
    expect(await attempt(unavailable.id)).toMatchObject({ status: "succeeded", disposition: "accepted" });
  });

  it("never leaves a provider success unreconciled", async () => {
    const { buyer, reservation } = await setup();
    const declined = await pay(buyer, reservation.id, "decline");
    await providerLaterSucceeds(declined.id);

    const open = await findUnreconciledProviderSuccesses(db);
    expect(open.map((o) => o.paymentAttemptId)).not.toContain(declined.id);
  });

  it("reports provider successes that cannot be attributed", async () => {
    const reference = `sim_orphan_${crypto.randomUUID().slice(0, 8)}`;
    const body = JSON.stringify(
      buildNotification(
        { providerReference: reference, merchantReference: crypto.randomUUID(), status: "succeeded", amountMinor: 4200, currency: "EUR" },
        "orphan",
      ),
    );
    expect(await handleProviderNotification(db, secret, body, signNotification(secret, body))).toBe("orphan");
    const open = await findUnreconciledProviderSuccesses(db);
    expect(open.find((o) => o.providerReference === reference)).toMatchObject({ outcome: "orphan", amountMinor: 4200 });
  });
});

describe("payment idempotency", () => {
  it("replays the same request and rejects the same key with different parameters", async () => {
    const { buyer, reservation } = await setup();
    const k = key();
    const first = await pay(buyer, reservation.id, "delayed_success", k);
    expect((await pay(buyer, reservation.id, "delayed_success", k)).id).toBe(first.id);
    await expectAppError(pay(buyer, reservation.id, "success", k), "CONFLICT", "idempotency_key_reused");
  });

  it("scopes keys to the reservation", async () => {
    const a = await setup();
    const b = await setup();
    const k = key();
    const first = await startPayment(db, deps, a.buyer, a.reservation.id, {}, { idempotencyKey: k });
    const second = await startPayment(db, deps, b.buyer, b.reservation.id, {}, { idempotencyKey: k });
    expect(first.id).not.toBe(second.id);
    expect(second.disposition).toBe("accepted");
  });
});
