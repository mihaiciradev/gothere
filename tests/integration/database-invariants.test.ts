import { and, eq, gte, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  auditRecords,
  experiences,
  inventoryItems,
  orders,
  paymentAttempts,
  reservationItems,
  reservations,
  tickets,
} from "@/infrastructure/db/schema";
import { expectDbRejection } from "./support/expect-db-error";
import { createAdmission, createEvent, createOrganization, createUser, openTestDatabase } from "./support/fixtures";

const { db, pool } = openTestDatabase(25);
afterAll(() => pool.end());

describe("inventory invariants", () => {
  it("rejects capacity overflow and negative counters", async () => {
    const event = await createEvent(db, (await createOrganization(db)).id);
    const item = await createAdmission(db, event, 10);

    await expectDbRejection(
      db.update(inventoryItems).set({ reserved: 8, sold: 3 }).where(eq(inventoryItems.id, item.id)),
      "inventory_items_no_oversell",
    );
    await expectDbRejection(
      db.update(inventoryItems).set({ reserved: -1 }).where(eq(inventoryItems.id, item.id)),
      "inventory_items_reserved_non_negative",
    );
  });

  it("guarded concurrent increments never exceed capacity", async () => {
    const event = await createEvent(db, (await createOrganization(db)).id);
    const item = await createAdmission(db, event, 10);

    const results = await Promise.all(
      Array.from({ length: 40 }, () =>
        db
          .update(inventoryItems)
          .set({ reserved: sql`${inventoryItems.reserved} + 1` })
          .where(
            and(
              eq(inventoryItems.id, item.id),
              gte(sql`${inventoryItems.capacity} - ${inventoryItems.reserved} - ${inventoryItems.sold}`, 1),
            ),
          )
          .returning({ id: inventoryItems.id }),
      ),
    );
    expect(results.filter((r) => r.length === 1)).toHaveLength(10);
  });

  it("unguarded concurrent increments are still stopped by the check constraint", async () => {
    const event = await createEvent(db, (await createOrganization(db)).id);
    const item = await createAdmission(db, event, 5);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        db.update(inventoryItems).set({ reserved: sql`${inventoryItems.reserved} + 1` }).where(eq(inventoryItems.id, item.id)),
      ),
    );
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(5);
  });
});

/** Builds a valid reservation → attempt → order chain to tamper with. */
async function purchaseChain() {
  const user = await createUser(db);
  const org = await createOrganization(db);
  const event = await createEvent(db, org.id);
  const item = await createAdmission(db, event, 10);
  const [reservation] = await db
    .insert(reservations)
    .values({
      userId: user.id,
      organizationId: org.id,
      eventId: event.id,
      currency: "EUR",
      totalMinor: 5000,
      expiresAt: new Date(Date.now() + 600_000),
      idempotencyKey: crypto.randomUUID(),
      requestHash: "test",
    })
    .returning();
  await db.insert(reservationItems).values({
    reservationId: reservation!.id,
    eventId: event.id,
    inventoryItemId: item.id,
    quantity: 1,
    unitPriceMinor: 5000,
  });
  // Count the hold as reserveUnits would, so the row stays consistent for anything that later sweeps it
  // (the e2e suite runs on this database after these tests).
  await db.update(inventoryItems).set({ reserved: sql`${inventoryItems.reserved} + 1` }).where(eq(inventoryItems.id, item.id));
  const [attempt] = await db
    .insert(paymentAttempts)
    .values({ reservationId: reservation!.id, idempotencyKey: crypto.randomUUID(), requestHash: "test", amountMinor: 5000, currency: "EUR" })
    .returning();
  return { user, org, event, item, reservation: reservation!, attempt: attempt! };
}

describe("cross-tenant and cross-event references", () => {
  it("rejects an experience whose organization differs from its event's", async () => {
    const eventA = await createEvent(db, (await createOrganization(db)).id);
    const orgB = await createOrganization(db);
    await expectDbRejection(
      db.insert(experiences).values({
        organizationId: orgB.id,
        eventId: eventA.id,
        slug: "cross-tenant",
        title: "x",
        description: "x",
        category: "music",
        startsAt: new Date("2030-07-01T18:00:00Z"),
        endsAt: new Date("2030-07-01T19:00:00Z"),
      }),
      "experiences_event_tenant_fk",
    );
  });

  it("rejects inventory attached to another tenant's event", async () => {
    const eventA = await createEvent(db, (await createOrganization(db)).id);
    const orgB = await createOrganization(db);
    await expectDbRejection(createAdmission(db, { id: eventA.id, organizationId: orgB.id }, 10), "inventory_items_event_tenant_fk");
  });

  it("rejects a reservation line holding inventory of a different event", async () => {
    const chain = await purchaseChain();
    const otherEvent = await createEvent(db, chain.org.id);
    const foreignItem = await createAdmission(db, otherEvent, 10);

    // Claiming the reservation's event while pointing at another event's item:
    await expectDbRejection(
      db.insert(reservationItems).values({
        reservationId: chain.reservation.id,
        eventId: chain.event.id,
        inventoryItemId: foreignItem.id,
        quantity: 1,
        unitPriceMinor: 1,
      }),
      "reservation_items_inventory_event_fk",
    );
    // Claiming the item's event instead:
    await expectDbRejection(
      db.insert(reservationItems).values({
        reservationId: chain.reservation.id,
        eventId: otherEvent.id,
        inventoryItemId: foreignItem.id,
        quantity: 1,
        unitPriceMinor: 1,
      }),
      "reservation_items_reservation_event_fk",
    );
  });

  it("rejects an order paid by another reservation's attempt or owned by another user", async () => {
    const a = await purchaseChain();
    const b = await purchaseChain();
    const base = {
      reservationId: a.reservation.id,
      userId: a.user.id,
      organizationId: a.org.id,
      eventId: a.event.id,
      totalMinor: 5000,
      currency: "EUR",
    };
    await expectDbRejection(db.insert(orders).values({ ...base, paymentAttemptId: b.attempt.id }), "orders_payment_reservation_fk");
    await expectDbRejection(
      db.insert(orders).values({ ...base, paymentAttemptId: a.attempt.id, userId: b.user.id }),
      "orders_reservation_user_event_fk",
    );
  });

  it("rejects tickets for items that were not reserved on the order", async () => {
    const chain = await purchaseChain();
    await db.update(paymentAttempts).set({ status: "succeeded" }).where(eq(paymentAttempts.id, chain.attempt.id));
    const [order] = await db
      .insert(orders)
      .values({
        reservationId: chain.reservation.id,
        paymentAttemptId: chain.attempt.id,
        userId: chain.user.id,
        organizationId: chain.org.id,
        eventId: chain.event.id,
        totalMinor: 5000,
        currency: "EUR",
      })
      .returning();
    const unreservedItem = await createAdmission(db, chain.event, 10);
    const ticket = {
      orderId: order!.id,
      reservationId: chain.reservation.id,
      userId: chain.user.id,
      organizationId: chain.org.id,
      eventId: chain.event.id,
      ordinal: 1,
    };

    await expectDbRejection(
      db.insert(tickets).values({ ...ticket, inventoryItemId: unreservedItem.id, code: crypto.randomUUID() }),
      "tickets_reservation_item_fk",
    );
    const stranger = await createUser(db);
    await expectDbRejection(
      db.insert(tickets).values({ ...ticket, inventoryItemId: chain.item.id, userId: stranger.id, code: crypto.randomUUID() }),
      "tickets_order_fk",
    );
    await db.insert(tickets).values({ ...ticket, inventoryItemId: chain.item.id, code: crypto.randomUUID() });
    await expectDbRejection(
      db.insert(tickets).values({ ...ticket, inventoryItemId: chain.item.id, code: crypto.randomUUID() }),
      "tickets_order_item_ordinal_unique",
    );
  });
});

describe("payment invariants", () => {
  it("rejects non-simulated payments", async () => {
    const chain = await purchaseChain();
    await expectDbRejection(
      db.insert(paymentAttempts).values({
        reservationId: chain.reservation.id,
        idempotencyKey: crypto.randomUUID(),
        requestHash: "test",
        amountMinor: 1,
        currency: "EUR",
        status: "failed",
        simulated: false,
      }),
      "payment_attempts_simulated_only",
    );
  });

  it("records several provider successes but accepts at most one", async () => {
    const chain = await purchaseChain();
    await db.update(paymentAttempts).set({ status: "unknown" }).where(eq(paymentAttempts.id, chain.attempt.id));
    const [second] = await db
      .insert(paymentAttempts)
      .values({ reservationId: chain.reservation.id, idempotencyKey: crypto.randomUUID(), requestHash: "test", amountMinor: 5000, currency: "EUR" })
      .returning();
    await db.update(paymentAttempts).set({ status: "succeeded" }).where(eq(paymentAttempts.reservationId, chain.reservation.id));

    await db.update(paymentAttempts).set({ disposition: "accepted" }).where(eq(paymentAttempts.id, chain.attempt.id));
    await expectDbRejection(
      db.update(paymentAttempts).set({ disposition: "accepted" }).where(eq(paymentAttempts.id, second!.id)),
      "payment_attempts_one_accepted_per_reservation",
    );
    await db.update(paymentAttempts).set({ disposition: "refund_required" }).where(eq(paymentAttempts.id, second!.id));
  });

  it("allows only one attempt in flight per reservation", async () => {
    const chain = await purchaseChain();
    await expectDbRejection(
      db.insert(paymentAttempts).values({
        reservationId: chain.reservation.id,
        idempotencyKey: crypto.randomUUID(),
        requestHash: "test",
        amountMinor: 5000,
        currency: "EUR",
      }),
      "payment_attempts_one_in_flight_per_reservation",
    );
  });

  it("rejects invalid payment state transitions and edits to recorded amounts", async () => {
    const chain = await purchaseChain();
    const set = (values: Partial<typeof paymentAttempts.$inferInsert>) =>
      db.update(paymentAttempts).set(values).where(eq(paymentAttempts.id, chain.attempt.id));

    await expectDbRejection(set({ disposition: "accepted" }), "payment_attempts_disposition_requires_success");
    await set({ status: "failed" });
    await expectDbRejection(set({ status: "pending" }), "payment_attempts_status_transition");
    await expectDbRejection(set({ status: "unknown" }), "payment_attempts_status_transition");
    await set({ status: "succeeded" }); // a provider success after a failure is always recordable
    await expectDbRejection(set({ status: "failed" }), "payment_attempts_status_transition");
    await expectDbRejection(set({ amountMinor: 1 }), "payment_attempts_immutable");
    await expectDbRejection(set({ requestHash: "tampered" }), "payment_attempts_immutable");
  });

  it("rejects disposition shortcuts", async () => {
    const chain = await purchaseChain();
    const set = (values: Partial<typeof paymentAttempts.$inferInsert>) =>
      db.update(paymentAttempts).set(values).where(eq(paymentAttempts.id, chain.attempt.id));
    await set({ status: "succeeded" });
    await expectDbRejection(set({ disposition: "refunded" }), "payment_attempts_disposition_transition");
    await set({ disposition: "accepted" });
    await expectDbRejection(set({ disposition: "refund_required" }), "payment_attempts_disposition_transition");
  });

  it("rejects leaving a terminal reservation state", async () => {
    const chain = await purchaseChain();
    await db.update(reservations).set({ status: "expired", closedAt: new Date() }).where(eq(reservations.id, chain.reservation.id));
    await expectDbRejection(
      db.update(reservations).set({ status: "converted" }).where(eq(reservations.id, chain.reservation.id)),
      "reservations_status_transition",
    );
    await expectDbRejection(
      db.update(reservations).set({ status: "active", closedAt: null }).where(eq(reservations.id, chain.reservation.id)),
      "reservations_status_transition",
    );
  });
});

describe("audit records", () => {
  it("are append-only", async () => {
    const [record] = await db
      .insert(auditRecords)
      .values({ actorType: "system", action: "test.append_only", outcome: "succeeded" })
      .returning();
    await expectDbRejection(db.update(auditRecords).set({ action: "tampered" }).where(eq(auditRecords.id, record!.id)));
    await expectDbRejection(db.delete(auditRecords).where(eq(auditRecords.id, record!.id)));
  });
});
