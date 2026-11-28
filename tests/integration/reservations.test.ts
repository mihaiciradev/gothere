import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { inventoryItems, reservations } from "@/infrastructure/db/schema";
import { startPayment } from "@/modules/payments";
import {
  MAX_ACTIVE_RESERVATIONS_PER_USER,
  createReservation,
  expireReservation,
  getReservationForOwner,
  releaseReservation,
  sweepOverdueReservations,
} from "@/modules/reservations";
import {
  createActor,
  createAdmission,
  createEvent,
  createExperienceItem,
  createSellableEvent,
  expectAppError,
  forceOverdue,
  inventory,
  key,
  openTestDatabase,
  simulatorDeps,
} from "./support/fixtures";

const { db, pool } = openTestDatabase(30);
afterAll(() => pool.end());

const reserve = (actor: Awaited<ReturnType<typeof createActor>>, eventId: string, items: { inventoryItemId: string; quantity: number }[], idempotencyKey = key()) =>
  createReservation(db, actor, { eventId, items }, { idempotencyKey });

describe("concurrency", () => {
  it("concurrent buyers never oversell", async () => {
    const { event, admission } = await createSellableEvent(db, 10);
    const buyers = await Promise.all(Array.from({ length: 30 }, () => createActor(db)));

    const outcomes = await Promise.allSettled(
      buyers.map((buyer) => reserve(buyer, event.id, [{ inventoryItemId: admission.id, quantity: 1 }])),
    );

    const succeeded = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(succeeded).toHaveLength(10);
    expect(rejected.every((r) => r.reason.code === "CONFLICT" && r.reason.details.reason === "insufficient_inventory")).toBe(true);
    const item = await inventory(db, admission.id);
    expect(item.reserved).toBe(10);
    expect(item.reserved + item.sold).toBeLessThanOrEqual(item.capacity);
  });

  it("concurrent requests from one user cannot bypass the active reservation cap", async () => {
    const { event, admission } = await createSellableEvent(db, 100);
    const buyer = await createActor(db);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 12 }, () => reserve(buyer, event.id, [{ inventoryItemId: admission.id, quantity: 1 }])),
    );

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(MAX_ACTIVE_RESERVATIONS_PER_USER);
    expect((await inventory(db, admission.id)).reserved).toBe(MAX_ACTIVE_RESERVATIONS_PER_USER);
  });

  it("multi-item reservations roll back completely when any line fails", async () => {
    const { event, admission } = await createSellableEvent(db, 50);
    const { item: scarce } = await createExperienceItem(db, event, 1);
    const buyer = await createActor(db);
    const other = await createActor(db);
    await reserve(other, event.id, [{ inventoryItemId: scarce.id, quantity: 1 }]);

    await expectAppError(
      reserve(buyer, event.id, [
        { inventoryItemId: admission.id, quantity: 3 },
        { inventoryItemId: scarce.id, quantity: 1 },
      ]),
      "CONFLICT",
      "insufficient_inventory",
    );

    expect((await inventory(db, admission.id)).reserved).toBe(0);
    expect(await db.select().from(reservations).where(eq(reservations.userId, buyer.userId))).toHaveLength(0);
  });

  it("opposite line orders from concurrent buyers do not deadlock", async () => {
    const { event, admission } = await createSellableEvent(db, 100);
    const second = await createAdmission(db, event, 100);
    const buyers = await Promise.all(Array.from({ length: 16 }, () => createActor(db)));

    await Promise.all(
      buyers.map((buyer, i) =>
        reserve(
          buyer,
          event.id,
          i % 2
            ? [{ inventoryItemId: admission.id, quantity: 1 }, { inventoryItemId: second.id, quantity: 1 }]
            : [{ inventoryItemId: second.id, quantity: 1 }, { inventoryItemId: admission.id, quantity: 1 }],
        ),
      ),
    );
    expect((await inventory(db, admission.id)).reserved).toBe(16);
    expect((await inventory(db, second.id)).reserved).toBe(16);
  });
});

describe("idempotency", () => {
  it("returns the same reservation for a repeated key with the same parameters, in any line order", async () => {
    const { event, admission } = await createSellableEvent(db, 20);
    const second = await createAdmission(db, event, 20);
    const buyer = await createActor(db);
    const k = key();

    const first = await reserve(buyer, event.id, [{ inventoryItemId: admission.id, quantity: 1 }, { inventoryItemId: second.id, quantity: 2 }], k);
    const again = await reserve(buyer, event.id, [{ inventoryItemId: second.id, quantity: 2 }, { inventoryItemId: admission.id, quantity: 1 }], k);

    expect(again.id).toBe(first.id);
    expect((await inventory(db, admission.id)).reserved).toBe(1);
  });

  it("rejects reusing a key with different parameters", async () => {
    const { event, admission } = await createSellableEvent(db, 20);
    const buyer = await createActor(db);
    const k = key();
    await reserve(buyer, event.id, [{ inventoryItemId: admission.id, quantity: 1 }], k);

    await expectAppError(reserve(buyer, event.id, [{ inventoryItemId: admission.id, quantity: 2 }], k), "CONFLICT", "idempotency_key_reused");
    expect((await inventory(db, admission.id)).reserved).toBe(1);
  });

  it("concurrent requests with the same key create exactly one reservation", async () => {
    const { event, admission } = await createSellableEvent(db, 20);
    const buyer = await createActor(db);
    const k = key();

    const results = await Promise.all(
      Array.from({ length: 8 }, () => reserve(buyer, event.id, [{ inventoryItemId: admission.id, quantity: 2 }], k)),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect((await inventory(db, admission.id)).reserved).toBe(2);
  });
});

describe("pricing", () => {
  it("rejects client-supplied prices and totals", async () => {
    const { event, admission } = await createSellableEvent(db, 20);
    const buyer = await createActor(db);
    const tampered = [
      { eventId: event.id, items: [{ inventoryItemId: admission.id, quantity: 1, unitPriceMinor: 1 }] },
      { eventId: event.id, items: [{ inventoryItemId: admission.id, quantity: 1 }], totalMinor: 1 },
      { eventId: event.id, items: [{ inventoryItemId: admission.id, quantity: 1 }], currency: "RON" },
    ];
    for (const body of tampered) {
      await expect(createReservation(db, buyer, body, { idempotencyKey: key() })).rejects.toMatchObject({ name: "ZodError" });
    }
  });

  it("captures prices at reservation time; later price changes do not alter the amount charged", async () => {
    const { event, admission } = await createSellableEvent(db, 20);
    const buyer = await createActor(db);
    const reservation = await reserve(buyer, event.id, [{ inventoryItemId: admission.id, quantity: 2 }]);
    expect(reservation.totalMinor).toBe(2 * admission.priceMinor);

    await db.update(inventoryItems).set({ priceMinor: 1 }).where(eq(inventoryItems.id, admission.id));
    const attempt = await startPayment(db, simulatorDeps(db), buyer, reservation.id, {}, { idempotencyKey: key() });
    expect(attempt.amountMinor).toBe(2 * admission.priceMinor);
    expect(attempt.disposition).toBe("accepted");
  });
});

describe("validation and ownership", () => {
  it("rejects items from a different event", async () => {
    const a = await createSellableEvent(db, 10);
    const b = await createSellableEvent(db, 10);
    const buyer = await createActor(db);
    await expectAppError(reserve(buyer, a.event.id, [{ inventoryItemId: b.admission.id, quantity: 1 }]), "NOT_FOUND");
    expect((await inventory(db, b.admission.id)).reserved).toBe(0);
  });

  it("rejects unpublished events, draft inventory and quantities above the per-order limit", async () => {
    const { organization, event, admission } = await createSellableEvent(db, 10);
    const buyer = await createActor(db);
    const draftEvent = await createEvent(db, organization.id, "draft");
    const draftEventItem = await createAdmission(db, draftEvent, 10);
    const draftItem = await createAdmission(db, event, 10, { status: "draft" });

    await expectAppError(reserve(buyer, draftEvent.id, [{ inventoryItemId: draftEventItem.id, quantity: 1 }]), "NOT_FOUND");
    await expectAppError(reserve(buyer, event.id, [{ inventoryItemId: draftItem.id, quantity: 1 }]), "PRECONDITION_FAILED");
    await expectAppError(reserve(buyer, event.id, [{ inventoryItemId: admission.id, quantity: 11 }]), "VALIDATION_FAILED");
  });

  it("rejects access to another user's reservation", async () => {
    const { event, admission } = await createSellableEvent(db, 10);
    const owner = await createActor(db);
    const intruder = await createActor(db);
    const reservation = await reserve(owner, event.id, [{ inventoryItemId: admission.id, quantity: 1 }]);

    await expectAppError(getReservationForOwner(db, intruder, reservation.id), "NOT_FOUND");
    await expectAppError(releaseReservation(db, intruder, reservation.id), "NOT_FOUND");
    await expectAppError(startPayment(db, simulatorDeps(db), intruder, reservation.id, {}, { idempotencyKey: key() }), "NOT_FOUND");
    expect((await inventory(db, admission.id)).reserved).toBe(1);
  });
});

describe("expiry", () => {
  it("expired reservations release inventory exactly once, even under concurrent expiry", async () => {
    const { event, admission } = await createSellableEvent(db, 10);
    const buyer = await createActor(db);
    const reservation = await reserve(buyer, event.id, [{ inventoryItemId: admission.id, quantity: 3 }]);
    await forceOverdue(db, reservation.id);

    const results = await Promise.all([
      ...Array.from({ length: 10 }, () => expireReservation(db, reservation.id)),
      sweepOverdueReservations(db, { limit: 1000 }).then((n) => n > 0),
      getReservationForOwner(db, buyer, reservation.id).then(() => false),
    ]);

    expect(results.filter(Boolean).length).toBeLessThanOrEqual(1);
    const item = await inventory(db, admission.id);
    expect(item.reserved).toBe(0);
    const view = await getReservationForOwner(db, buyer, reservation.id);
    expect(view.status).toBe("expired");
  });

  it("skips an inconsistent hold without blocking other expiries or new reservations", async () => {
    // A poisoned row: an overdue hold whose units are missing from the counter (releasing it would break an invariant).
    const poisoned = await createSellableEvent(db, 10);
    const healthy = await createSellableEvent(db, 10);
    const poisonedHold = await reserve(await createActor(db), poisoned.event.id, [{ inventoryItemId: poisoned.admission.id, quantity: 1 }]);
    const healthyHold = await reserve(await createActor(db), healthy.event.id, [{ inventoryItemId: healthy.admission.id, quantity: 1 }]);
    await db.update(inventoryItems).set({ reserved: 0 }).where(eq(inventoryItems.id, poisoned.admission.id));
    await forceOverdue(db, poisonedHold.id);
    await forceOverdue(db, healthyHold.id);

    await expect(sweepOverdueReservations(db, { limit: 1000 })).resolves.toBeGreaterThanOrEqual(1);
    const [healthyRow] = await db.select().from(reservations).where(eq(reservations.id, healthyHold.id));
    const [poisonedRow] = await db.select().from(reservations).where(eq(reservations.id, poisonedHold.id));
    expect(healthyRow!.status).toBe("expired");
    expect(poisonedRow!.status).toBe("active"); // left for investigation, not silently "fixed"
    expect((await inventory(db, healthy.admission.id)).reserved).toBe(0);

    // Reserving the affected item still works (its pre-reserve sweep skips the bad row instead of throwing).
    const next = await reserve(await createActor(db), poisoned.event.id, [{ inventoryItemId: poisoned.admission.id, quantity: 1 }]);
    expect(next.status).toBe("active");

    // Clean up so later suites (and the e2e run on this database) never meet the poisoned row.
    await db.update(inventoryItems).set({ reserved: 2 }).where(eq(inventoryItems.id, poisoned.admission.id));
    await expireReservation(db, poisonedHold.id);
  });

  it("does not let an overdue hold block other buyers, even with no expiry job running", async () => {
    const { event, admission } = await createSellableEvent(db, 2);
    const first = await createActor(db);
    const second = await createActor(db);
    const held = await reserve(first, event.id, [{ inventoryItemId: admission.id, quantity: 2 }]);
    await forceOverdue(db, held.id);

    const reservation = await reserve(second, event.id, [{ inventoryItemId: admission.id, quantity: 2 }]);
    expect(reservation.status).toBe("active");
    const item = await inventory(db, admission.id);
    expect(item.reserved).toBe(2);
  });

  it("releasing returns units once and is idempotent", async () => {
    const { event, admission } = await createSellableEvent(db, 10);
    const buyer = await createActor(db);
    const reservation = await reserve(buyer, event.id, [{ inventoryItemId: admission.id, quantity: 4 }]);

    await Promise.all([releaseReservation(db, buyer, reservation.id), releaseReservation(db, buyer, reservation.id)]);
    expect((await inventory(db, admission.id)).reserved).toBe(0);
  });
});
