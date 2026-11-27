import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { jobHandlers } from "@/composition/runtime";
import type { Database } from "@/infrastructure/db/client";
import {
  jobs,
  orders,
  paymentAttempts,
  paymentProviderEvents,
  reservations,
  simulatorPayments,
  tickets,
} from "@/infrastructure/db/schema";
import type { Actor } from "@/modules/identity";
import { runDueJobs } from "@/modules/operations";
import {
  buildNotification,
  createSimulatorProvider,
  handleProviderNotification,
  processProviderEvent,
  reconcileAttempt,
  reconcilePayments,
  recordProviderEvent,
  signNotification,
  startPayment,
} from "@/modules/payments";
import { createReservation, expireReservation } from "@/modules/reservations";
import {
  createActor,
  createSellableEvent,
  expectAppError,
  forceOverdue,
  inventory,
  key,
  openTestDatabase,
  simulatorDeps,
} from "./support/fixtures";

const { db, pool } = openTestDatabase(20);
afterAll(() => pool.end());

const secret = process.env.PAYMENT_WEBHOOK_SECRET!;
const deps = simulatorDeps(db);

async function setup(capacity = 10, quantity = 2) {
  const { event, admission } = await createSellableEvent(db, capacity);
  const buyer = await createActor(db);
  const reservation = await createReservation(
    db,
    buyer,
    { eventId: event.id, items: [{ inventoryItemId: admission.id, quantity }] },
    { idempotencyKey: key() },
  );
  return { event, admission, buyer, reservation };
}

const pay = (actor: Actor, reservationId: string, scenario = "success", idempotencyKey = key()) =>
  startPayment(db, deps, actor, reservationId, { scenario }, { idempotencyKey });

/** Makes every queued job due now and runs the worker until the queue is drained. */
async function drainJobs(database: Database = db) {
  for (let i = 0; i < 5; i++) {
    await database.update(jobs).set({ runAt: sql`now()` }).where(eq(jobs.status, "queued"));
    const summary = await runDueJobs(database, jobHandlers(database, secret), { limit: 100 });
    if (summary.claimed === 0) return;
  }
}

async function ordersFor(reservationId: string) {
  return db.select().from(orders).where(eq(orders.reservationId, reservationId));
}
async function ticketsFor(reservationId: string) {
  return db.select().from(tickets).where(eq(tickets.reservationId, reservationId));
}
async function attempt(id: string) {
  const [row] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.id, id));
  return row!;
}
async function reservationStatus(id: string) {
  const [row] = await db.select({ status: reservations.status }).from(reservations).where(eq(reservations.id, id));
  return row!.status;
}

/** Sends a signed provider notification for an attempt, as the simulator's webhook would. */
async function notify(attemptId: string, overrides: { status?: "succeeded" | "failed" | "pending"; amountMinor?: number; suffix?: string } = {}) {
  const [ledger] = await db.select().from(simulatorPayments).where(eq(simulatorPayments.merchantReference, attemptId));
  const a = await attempt(attemptId);
  const notification = buildNotification(
    {
      providerReference: ledger!.providerReference,
      merchantReference: attemptId,
      status: overrides.status ?? "succeeded",
      amountMinor: overrides.amountMinor ?? a.amountMinor,
      currency: a.currency,
    },
    overrides.suffix ?? "manual",
  );
  const body = JSON.stringify(notification);
  return handleProviderNotification(db, secret, body, signNotification(secret, body));
}

describe("payment lifecycle", () => {
  it("success confirms the order and issues one ticket per unit", async () => {
    const { admission, buyer, reservation } = await setup(10, 2);
    const result = await pay(buyer, reservation.id);

    expect(result).toMatchObject({ status: "succeeded", disposition: "accepted", simulated: true });
    expect(await reservationStatus(reservation.id)).toBe("converted");
    expect(await ordersFor(reservation.id)).toHaveLength(1);
    expect(await ticketsFor(reservation.id)).toHaveLength(2);
    expect(await inventory(db, admission.id)).toMatchObject({ reserved: 0, sold: 2 });

    await drainJobs(); // the provider's webhook for the same success arrives later
    expect(await ordersFor(reservation.id)).toHaveLength(1);
    expect(await ticketsFor(reservation.id)).toHaveLength(2);
  });

  it("a declined payment keeps the hold and can be retried", async () => {
    const { admission, buyer, reservation } = await setup(10, 1);
    const declined = await pay(buyer, reservation.id, "decline");
    expect(declined).toMatchObject({ status: "failed", failureCode: "card_declined" });
    expect(await reservationStatus(reservation.id)).toBe("active");
    expect((await inventory(db, admission.id)).reserved).toBe(1);

    const retried = await pay(buyer, reservation.id);
    expect(retried.disposition).toBe("accepted");
    expect(await ticketsFor(reservation.id)).toHaveLength(1);
  });

  it("provider unavailability fails the attempt without charging and allows a retry", async () => {
    const { buyer, reservation } = await setup(10, 1);
    const unavailable = await pay(buyer, reservation.id, "unavailable");
    expect(unavailable).toMatchObject({ status: "failed", failureCode: "provider_unavailable" });
    expect(await db.select().from(simulatorPayments).where(eq(simulatorPayments.merchantReference, unavailable.id))).toHaveLength(0);

    expect((await pay(buyer, reservation.id)).disposition).toBe("accepted");
  });

  it("delayed confirmation stays pending until the notification arrives", async () => {
    const { buyer, reservation } = await setup(10, 1);
    const pending = await pay(buyer, reservation.id, "delayed_success");
    expect(pending.status).toBe("pending");
    expect(await reservationStatus(reservation.id)).toBe("active");

    await drainJobs();
    expect(await attempt(pending.id)).toMatchObject({ status: "succeeded", disposition: "accepted" });
    expect(await ticketsFor(reservation.id)).toHaveLength(1);
  });

  it("duplicate notifications create no extra orders or tickets", async () => {
    const { buyer, reservation } = await setup(10, 3);
    const result = await pay(buyer, reservation.id, "duplicate_notification");
    await drainJobs();
    await notify(result.id);
    await notify(result.id);

    expect(await ordersFor(reservation.id)).toHaveLength(1);
    expect(await ticketsFor(reservation.id)).toHaveLength(3);
    const dupEvents = await db
      .select()
      .from(paymentProviderEvents)
      .where(eq(paymentProviderEvents.paymentAttemptId, result.id));
    expect(dupEvents.filter((e) => e.providerEventId.endsWith("_dup"))).toHaveLength(1);
    expect(dupEvents.filter((e) => e.outcome === "accepted")).toHaveLength(1);
  });

  it("out-of-order notifications cannot move a payment backwards", async () => {
    const { buyer, reservation } = await setup(10, 1);
    const result = await pay(buyer, reservation.id, "out_of_order");
    await drainJobs();
    expect(await notify(result.id, { status: "pending", suffix: "late-pending" })).toBe("ignored_stale");
    expect(await notify(result.id, { status: "failed", suffix: "late-failed" })).toBe("ignored_stale");
    expect(await attempt(result.id)).toMatchObject({ status: "succeeded", disposition: "accepted" });
  });

  it("a timed-out payment is resolved by reconciliation", async () => {
    const { buyer, reservation } = await setup(10, 1);
    const unknown = await pay(buyer, reservation.id, "timeout");
    expect(unknown.status).toBe("unknown");
    expect(await ordersFor(reservation.id)).toHaveLength(0);

    await drainJobs(); // the reconcile_attempt job queries the provider
    expect(await attempt(unknown.id)).toMatchObject({ status: "succeeded", disposition: "accepted" });
    expect(await ticketsFor(reservation.id)).toHaveLength(1);
  });

  it("rejects a second attempt while one is in flight and replays the same key", async () => {
    const { buyer, reservation } = await setup(10, 1);
    const k = key();
    const pending = await pay(buyer, reservation.id, "delayed_success", k);
    await expectAppError(pay(buyer, reservation.id), "CONFLICT", "payment_in_progress");
    expect((await pay(buyer, reservation.id, "delayed_success", k)).id).toBe(pending.id);
  });

  it("refuses to pay an expired reservation and releases its units", async () => {
    const { admission, buyer, reservation } = await setup(10, 2);
    await forceOverdue(db, reservation.id);
    await expectAppError(pay(buyer, reservation.id), "PRECONDITION_FAILED", "reservation_expired");
    expect(await reservationStatus(reservation.id)).toBe("expired");
    expect((await inventory(db, admission.id)).reserved).toBe(0);
  });

  it("refuses to pay an already converted reservation", async () => {
    const { buyer, reservation } = await setup(10, 1);
    await pay(buyer, reservation.id);
    await expectAppError(pay(buyer, reservation.id), "CONFLICT", "already_paid");
  });

  it("rejects simulator scenarios where they are disabled", async () => {
    const { buyer, reservation } = await setup(10, 1);
    await expectAppError(
      startPayment(db, { ...deps, allowScenarios: false }, buyer, reservation.id, { scenario: "decline" }, { idempotencyKey: key() }),
      "FORBIDDEN",
    );
  });
});

describe("multiple and late provider successes", () => {
  it("records every success, accepts one and refunds the duplicate", async () => {
    const { admission, buyer, reservation } = await setup(10, 2);
    const timedOut = await pay(buyer, reservation.id, "timeout"); // charged at the provider, unknown to us
    const second = await pay(buyer, reservation.id); // attendee retries
    expect(second.disposition).toBe("accepted");

    expect(await reconcileAttempt(db, deps.provider, timedOut.id)).toBe("settled");
    expect(await attempt(timedOut.id)).toMatchObject({ status: "succeeded", disposition: "refund_required" });

    await drainJobs();
    expect(await attempt(timedOut.id)).toMatchObject({ disposition: "refunded" });
    const [ledger] = await db.select().from(simulatorPayments).where(eq(simulatorPayments.merchantReference, timedOut.id));
    expect(ledger!.status).toBe("refunded");
    expect(await ordersFor(reservation.id)).toHaveLength(1);
    expect(await ticketsFor(reservation.id)).toHaveLength(2);
    expect(await inventory(db, admission.id)).toMatchObject({ reserved: 0, sold: 2 });
  });

  it("a success after expiry and resale is refunded and never oversells", async () => {
    const { event, admission, buyer, reservation } = await setup(2, 2);
    const late = await pay(buyer, reservation.id, "delayed_success");
    await forceOverdue(db, reservation.id);

    const rival = await createActor(db);
    const rivalReservation = await createReservation(
      db,
      rival,
      { eventId: event.id, items: [{ inventoryItemId: admission.id, quantity: 2 }] },
      { idempotencyKey: key() },
    );
    expect((await pay(rival, rivalReservation.id)).disposition).toBe("accepted");

    await drainJobs(); // the late success notification arrives
    expect(await attempt(late.id)).toMatchObject({ status: "succeeded", disposition: "refunded" });
    expect(await reservationStatus(reservation.id)).toBe("expired");
    expect(await ticketsFor(reservation.id)).toHaveLength(0);
    const item = await inventory(db, admission.id);
    expect(item).toMatchObject({ sold: 2, reserved: 0, capacity: 2 });
  });

  it("a success for an overdue but not yet swept reservation is not accepted", async () => {
    const { admission, buyer, reservation } = await setup(10, 1);
    const pending = await pay(buyer, reservation.id, "delayed_success");
    await forceOverdue(db, reservation.id);
    await drainJobs();

    expect(await attempt(pending.id)).toMatchObject({ status: "succeeded", disposition: "refunded" });
    expect(await reservationStatus(reservation.id)).toBe("expired");
    expect(await inventory(db, admission.id)).toMatchObject({ reserved: 0, sold: 0 });
  });

  it("a success with a different amount is never accepted", async () => {
    const { buyer, reservation } = await setup(10, 1);
    const pending = await pay(buyer, reservation.id, "delayed_success");
    expect(await notify(pending.id, { amountMinor: 1 })).toBe("refund_required:amount_mismatch");
    expect(await ordersFor(reservation.id)).toHaveLength(0);
    expect(await reservationStatus(reservation.id)).toBe("active");
  });

  it("concurrent expiry and confirmation always end in exactly one consistent outcome", async () => {
    const outcomes = { converted: 0, expired: 0 };
    for (let i = 0; i < 20; i++) {
      const { admission, buyer, reservation } = await setup(5, 1);
      const pending = await pay(buyer, reservation.id, "delayed_success");
      await db
        .update(reservations)
        .set({ expiresAt: sql`now() + make_interval(secs => ${(i % 5) * 0.01})` })
        .where(eq(reservations.id, reservation.id));

      await Promise.all([
        (async () => {
          for (let tries = 0; tries < 20 && !(await expireReservation(db, reservation.id)); tries++) {
            if ((await reservationStatus(reservation.id)) !== "active") break;
            await new Promise((r) => setTimeout(r, 5));
          }
        })(),
        new Promise((r) => setTimeout(r, i % 4) as unknown as void).then(() => notify(pending.id, { suffix: `race-${i}` })),
      ]);

      const status = await reservationStatus(reservation.id);
      const a = await attempt(pending.id);
      const item = await inventory(db, admission.id);
      const orderCount = (await ordersFor(reservation.id)).length;
      const ticketCount = (await ticketsFor(reservation.id)).length;
      expect(item.reserved).toBe(0);
      if (status === "converted") {
        outcomes.converted += 1;
        expect([a.disposition, orderCount, ticketCount, item.sold]).toEqual(["accepted", 1, 1, 1]);
      } else {
        outcomes.expired += 1;
        expect(status).toBe("expired");
        expect(["refund_required", "refunded"]).toContain(a.disposition);
        expect([orderCount, ticketCount, item.sold]).toEqual([0, 0, 0]);
      }
    }
    console.info(`expiry/confirmation race outcomes over 20 runs: ${JSON.stringify(outcomes)}`);
    expect(outcomes.converted + outcomes.expired).toBe(20);
  });
});

describe("provider notification security and recovery", () => {
  it("rejects unsigned, tampered and stale notifications before recording them", async () => {
    const { buyer, reservation } = await setup(10, 1);
    const pending = await pay(buyer, reservation.id, "delayed_success");
    const [ledger] = await db.select().from(simulatorPayments).where(eq(simulatorPayments.merchantReference, pending.id));
    const body = JSON.stringify(
      buildNotification(
        { providerReference: ledger!.providerReference, merchantReference: pending.id, status: "succeeded", amountMinor: pending.amountMinor, currency: "EUR" },
        "forged",
      ),
    );

    await expectAppError(handleProviderNotification(db, secret, body, null), "UNAUTHENTICATED");
    await expectAppError(handleProviderNotification(db, secret, body, signNotification("x".repeat(40), body)), "UNAUTHENTICATED");
    await expectAppError(
      handleProviderNotification(db, secret, body.replace(`"amountMinor":${pending.amountMinor}`, '"amountMinor":1'), signNotification(secret, body)),
      "UNAUTHENTICATED",
    );
    const stale = Math.floor(Date.now() / 1000) - 3600;
    await expectAppError(handleProviderNotification(db, secret, body, signNotification(secret, body, stale)), "UNAUTHENTICATED");

    const recorded = await db.select().from(paymentProviderEvents).where(eq(paymentProviderEvents.providerEventId, JSON.parse(body).id));
    expect(recorded).toHaveLength(0);
    expect((await attempt(pending.id)).status).toBe("pending");
  });

  it("records notifications for unknown payments as orphans without side effects", async () => {
    const body = JSON.stringify(
      buildNotification(
        { providerReference: "sim_orphan", merchantReference: crypto.randomUUID(), status: "succeeded", amountMinor: 100, currency: "EUR" },
        `orphan-${crypto.randomUUID()}`,
      ),
    );
    expect(await handleProviderNotification(db, secret, body, signNotification(secret, body))).toBe("orphan");
  });

  it("a recorded success whose processing never ran is recovered by reconciliation", async () => {
    const { buyer, reservation } = await setup(10, 1);
    const pending = await pay(buyer, reservation.id, "delayed_success");
    await db.delete(jobs).where(and(eq(jobs.status, "queued"), sql`${jobs.payload}->'notification'->'data'->>'merchantReference' = ${pending.id}`));
    const [ledger] = await db.select().from(simulatorPayments).where(eq(simulatorPayments.merchantReference, pending.id));

    // Crash between "record" and "process": the event is durable but unprocessed.
    const eventId = await recordProviderEvent(db, {
      providerEventId: `crash_${ledger!.providerReference}`,
      source: "webhook",
      payment: { providerReference: ledger!.providerReference, merchantReference: pending.id, status: "succeeded", amountMinor: pending.amountMinor, currency: "EUR" },
    });
    await db.update(paymentProviderEvents).set({ receivedAt: sql`now() - interval '1 minute'` }).where(eq(paymentProviderEvents.id, eventId));

    await reconcilePayments(db, createSimulatorProvider(db));
    expect(await attempt(pending.id)).toMatchObject({ status: "succeeded", disposition: "accepted" });
    expect(await processProviderEvent(db, eventId)).toBe("already_processed");
  });
});
