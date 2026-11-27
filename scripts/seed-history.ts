import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../src/infrastructure/db/client";
import { events, inventoryItems, orders, users } from "../src/infrastructure/db/schema";
import type { Actor } from "../src/modules/identity";
import { createSimulatorProvider, startPayment } from "../src/modules/payments";
import { createReservation } from "../src/modules/reservations";

/**
 * Historical sales for Halcyon Shore, produced by the real reservation and payment services so every
 * invariant applies. All rows are stamped origin = 'seed'. Synthetic buyers have no credentials and
 * cannot sign in. Only timestamps are rewritten afterwards (to spread history over past weeks);
 * counters, orders and tickets are exactly what the services produced.
 */

const EVENT_SLUG = "halcyon-shore-2027";
const BUYERS = 240;

/** Deterministic PRNG so every seed run produces the same history. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Line = { inventoryItemId: string; quantity: number };

export async function seedPurchaseHistory(db: Database): Promise<{ orders: number; skipped: boolean }> {
  const [event] = await db.select().from(events).where(eq(events.slug, EVENT_SLUG));
  if (!event) throw new Error(`${EVENT_SLUG} must be seeded first`);

  const [existing] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.eventId, event.id), eq(orders.origin, "seed")));
  if ((existing?.count ?? 0) > 0) return { orders: existing!.count, skipped: true };

  const items = await db.select().from(inventoryItems).where(eq(inventoryItems.eventId, event.id));
  const byName = (name: string) => {
    const item = items.find((i) => i.name === name);
    if (!item) throw new Error(`inventory item ${name} missing`);
    return item.id;
  };
  const ga = byName("3-Day General Admission");
  const vip = byName("3-Day VIP");
  const dayPass = byName("Saturday Day Pass");
  const sunset = byName("Sunset Sessions · Saturday");
  const chefs = byName("Chef's Table · Friday");
  const yoga = byName("Sunrise Yoga · Sunday");
  const talk = byName("Producer Talk");

  const buyerRows = Array.from({ length: BUYERS }, (_, i) => {
    const n = String(i + 1).padStart(3, "0");
    return { name: `Seed Buyer ${n}`, email: `buyer-${n}@buyers.seed.gothere.test`, emailVerified: true };
  });
  await db.insert(users).values(buyerRows).onConflictDoNothing();
  const buyers = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.email, buyerRows.map((b) => b.email)));
  buyers.sort((a, b) => a.email.localeCompare(b.email));

  const random = mulberry32(2027);
  const admission = (): Line => {
    const roll = random();
    if (roll < 0.12) return { inventoryItemId: vip, quantity: 1 + Math.floor(random() * 2) };
    if (roll < 0.25) return { inventoryItemId: dayPass, quantity: 1 + Math.floor(random() * 2) };
    return { inventoryItemId: ga, quantity: 1 + Math.floor(random() * 3) };
  };
  // Sunset Sessions: 75 buyers × 2 = 150 = capacity → sold out. Chef's Table: 18 × 2 = 36 of 40.
  const experienceFor = (index: number): Line | null => {
    if (index < 75) return { inventoryItemId: sunset, quantity: 2 };
    if (index < 93) return { inventoryItemId: chefs, quantity: 2 };
    if (index < 128) return { inventoryItemId: yoga, quantity: 1 };
    if (index < 170) return { inventoryItemId: talk, quantity: 1 + Math.floor(random() * 2) };
    return null;
  };

  const deps = { provider: createSimulatorProvider(db, { webhooks: false }), allowScenarios: false };
  let created = 0;
  for (const [index, buyer] of buyers.entries()) {
    const actor: Actor = { kind: "user", userId: buyer.id, email: buyer.email, platformRole: "attendee" };
    const extra = experienceFor(index);
    const lines = [admission(), ...(extra ? [extra] : [])];
    const reservation = await createReservation(
      db,
      actor,
      { eventId: event.id, items: lines },
      { idempotencyKey: `seed-${EVENT_SLUG}-${index}`, origin: "seed" },
    );
    const attempt = await startPayment(db, deps, actor, reservation.id, { scenario: "success" }, {
      idempotencyKey: `seed-pay-${EVENT_SLUG}-${index}`,
    });
    if (attempt.disposition !== "accepted") throw new Error(`seed purchase ${index} was not accepted`);
    created += 1;

    // Spread history over the past ~12 weeks; Sunset Sessions sells out early.
    const daysAgo = index < 75 ? 60 + (index % 25) : 5 + Math.floor(random() * 80);
    const minutesAgo = daysAgo * 24 * 60 + Math.floor(random() * 600);
    await db.execute(sql`
      WITH t AS (SELECT now() - make_interval(mins => ${minutesAgo}) AS at)
      UPDATE reservations SET created_at = t.at, updated_at = t.at + interval '2 minutes',
        expires_at = t.at + interval '10 minutes', closed_at = t.at + interval '2 minutes'
      FROM t WHERE reservations.id = ${reservation.id}`);
    await db.execute(sql`
      WITH t AS (SELECT now() - make_interval(mins => ${minutesAgo}) + interval '2 minutes' AS at)
      UPDATE payment_attempts SET created_at = t.at - interval '1 minute', updated_at = t.at, completed_at = t.at
      FROM t WHERE payment_attempts.reservation_id = ${reservation.id}`);
    await db.execute(sql`
      WITH t AS (SELECT now() - make_interval(mins => ${minutesAgo}) + interval '2 minutes' AS at)
      UPDATE orders SET confirmed_at = t.at FROM t WHERE orders.reservation_id = ${reservation.id}`);
    await db.execute(sql`
      WITH t AS (SELECT now() - make_interval(mins => ${minutesAgo}) + interval '2 minutes' AS at)
      UPDATE tickets SET issued_at = t.at FROM t WHERE tickets.reservation_id = ${reservation.id}`);
  }
  return { orders: created, skipped: false };
}
