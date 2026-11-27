import { and, eq, gte, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  auditRecords,
  experiences,
  inventoryItems,
  orders,
  paymentAttempts,
  reservations,
  tickets,
} from "@/infrastructure/db/schema";
import { expectDbRejection } from "./support/expect-db-error";
import { createAdmission, createEvent, createOrganization, createUser, openTestDatabase } from "./support/fixtures";

const { db, pool } = openTestDatabase(25);
afterAll(() => pool.end());

describe("inventory invariants", () => {
  it("rejects capacity overflow and negative counters at the database level", async () => {
    const org = await createOrganization(db);
    const event = await createEvent(db, org.id);
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

  it("guarded concurrent reservations never exceed capacity", async () => {
    const org = await createOrganization(db);
    const event = await createEvent(db, org.id);
    const item = await createAdmission(db, event, 10);

    const attempts = Array.from({ length: 40 }, () =>
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
    );
    const results = await Promise.all(attempts);

    expect(results.filter((r) => r.length === 1)).toHaveLength(10);
    const [final] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, item.id));
    expect(final!.reserved).toBe(10);
  });

  it("unguarded concurrent increments are still stopped by the check constraint", async () => {
    const org = await createOrganization(db);
    const event = await createEvent(db, org.id);
    const item = await createAdmission(db, event, 5);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        db
          .update(inventoryItems)
          .set({ reserved: sql`${inventoryItems.reserved} + 1` })
          .where(eq(inventoryItems.id, item.id)),
      ),
    );

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(5);
    const [final] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, item.id));
    expect(final!.reserved).toBe(5);
  });
});

describe("tenant consistency", () => {
  it("rejects an experience whose organization differs from its event's organization", async () => {
    const orgA = await createOrganization(db);
    const orgB = await createOrganization(db);
    const eventA = await createEvent(db, orgA.id);

    await expectDbRejection(
      db.insert(experiences).values({
        organizationId: orgB.id,
        eventId: eventA.id,
        slug: "cross-tenant",
        title: "Cross tenant",
        description: "Should never exist",
        category: "music",
        startsAt: new Date("2027-07-01T18:00:00Z"),
        endsAt: new Date("2027-07-01T19:00:00Z"),
      }),
      "experiences_event_tenant_fk",
    );
  });

  it("rejects inventory attached to another tenant's event", async () => {
    const orgA = await createOrganization(db);
    const orgB = await createOrganization(db);
    const eventA = await createEvent(db, orgA.id);

    await expectDbRejection(
      createAdmission(db, { id: eventA.id, organizationId: orgB.id }, 10),
      "inventory_items_event_tenant_fk",
    );
  });
});

describe("payment and ticket invariants", () => {
  async function reservationFixture() {
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
      })
      .returning();
    return { user, org, event, item, reservation: reservation! };
  }

  const attempt = (reservationId: string, status: "succeeded" | "failed", extra: { simulated?: boolean } = {}) =>
    db
      .insert(paymentAttempts)
      .values({
        reservationId,
        idempotencyKey: crypto.randomUUID(),
        status,
        amountMinor: 5000,
        currency: "EUR",
        ...extra,
      })
      .returning();

  it("rejects non-simulated payments", async () => {
    const { reservation } = await reservationFixture();
    await expectDbRejection(attempt(reservation.id, "succeeded", { simulated: false }), "payment_attempts_simulated_only");
  });

  it("allows at most one succeeded payment per reservation", async () => {
    const { reservation } = await reservationFixture();
    await attempt(reservation.id, "failed");
    await attempt(reservation.id, "succeeded");
    await expectDbRejection(attempt(reservation.id, "succeeded"), "payment_attempts_one_success_per_reservation");
  });

  it("allows one order per reservation and rejects duplicate ticket issuance", async () => {
    const { user, org, event, item, reservation } = await reservationFixture();
    const [payment] = await attempt(reservation.id, "succeeded");
    const orderValues = {
      reservationId: reservation.id,
      paymentAttemptId: payment!.id,
      userId: user.id,
      organizationId: org.id,
      eventId: event.id,
      totalMinor: 5000,
      currency: "EUR",
    };
    const [order] = await db.insert(orders).values(orderValues).returning();
    await expectDbRejection(db.insert(orders).values(orderValues), "orders_reservation_id_unique");

    const ticket = {
      orderId: order!.id,
      inventoryItemId: item.id,
      userId: user.id,
      organizationId: org.id,
      eventId: event.id,
      ordinal: 1,
    };
    await db.insert(tickets).values({ ...ticket, code: crypto.randomUUID() });
    await expectDbRejection(
      db.insert(tickets).values({ ...ticket, code: crypto.randomUUID() }),
      "tickets_order_item_ordinal_unique",
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
