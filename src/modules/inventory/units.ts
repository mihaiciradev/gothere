import { and, eq, sql } from "drizzle-orm";
import type { DbExecutor, Transaction } from "@/infrastructure/db/client";
import { inventoryItems } from "@/infrastructure/db/schema";
import { AppError } from "@/shared/errors";

export type UnitLine = Readonly<{ inventoryItemId: string; quantity: number }>;
export type PricedLine = UnitLine & Readonly<{ unitPriceMinor: number; currency: string }>;

/** Every multi-row inventory mutation locks rows in this order, which rules out lock-order deadlocks. */
export function inLockOrder<T extends UnitLine>(lines: readonly T[]): T[] {
  return [...lines].sort((a, b) => (a.inventoryItemId < b.inventoryItemId ? -1 : a.inventoryItemId > b.inventoryItemId ? 1 : 0));
}

const sellable = (eventId: string, line: UnitLine) =>
  and(
    eq(inventoryItems.id, line.inventoryItemId),
    eq(inventoryItems.eventId, eventId),
    eq(inventoryItems.status, "on_sale"),
    sql`${line.quantity} <= ${inventoryItems.maxPerOrder}`,
    sql`${inventoryItems.capacity} - ${inventoryItems.reserved} - ${inventoryItems.sold} >= ${line.quantity}`,
    sql`(${inventoryItems.salesStartAt} IS NULL OR ${inventoryItems.salesStartAt} <= now())`,
    sql`(${inventoryItems.salesEndAt} IS NULL OR ${inventoryItems.salesEndAt} > now())`,
    sql`(inventory_items.experience_id IS NULL OR EXISTS (
      SELECT 1 FROM experiences e WHERE e.id = inventory_items.experience_id AND e.status = 'published'))`,
  );

/**
 * Reserves every line or throws. Each line is one guarded UPDATE (no read-then-write), executed in lock
 * order. Prices and currency are read from the locked row: client-supplied prices are never used.
 * Must run inside the caller's transaction so a failure on any line rolls back all of them.
 */
export async function reserveUnits(tx: Transaction, eventId: string, lines: readonly UnitLine[]): Promise<PricedLine[]> {
  const priced: PricedLine[] = [];
  for (const line of inLockOrder(lines)) {
    const [row] = await tx
      .update(inventoryItems)
      .set({ reserved: sql`${inventoryItems.reserved} + ${line.quantity}` })
      .where(sellable(eventId, line))
      .returning({ priceMinor: inventoryItems.priceMinor, currency: inventoryItems.currency });
    if (!row) throw await unavailableReason(tx, eventId, line);
    priced.push({ ...line, unitPriceMinor: row.priceMinor, currency: row.currency });
  }
  return priced;
}

async function unavailableReason(db: DbExecutor, eventId: string, line: UnitLine): Promise<AppError> {
  const [item] = await db
    .select({
      eventId: inventoryItems.eventId,
      status: inventoryItems.status,
      maxPerOrder: inventoryItems.maxPerOrder,
      available: sql<number>`${inventoryItems.capacity} - ${inventoryItems.reserved} - ${inventoryItems.sold}`,
    })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, line.inventoryItemId));
  const details = { inventoryItemId: line.inventoryItemId };
  if (!item || item.eventId !== eventId) {
    return new AppError("NOT_FOUND", "That ticket type does not exist for this event.", details);
  }
  if (line.quantity > item.maxPerOrder) {
    return new AppError("VALIDATION_FAILED", `At most ${item.maxPerOrder} per order.`, { ...details, maxPerOrder: item.maxPerOrder });
  }
  if (item.status !== "on_sale" || item.available >= line.quantity) {
    return new AppError("PRECONDITION_FAILED", "That ticket type is not on sale.", { ...details, reason: "not_on_sale" });
  }
  return new AppError("CONFLICT", "Not enough availability left.", {
    ...details,
    reason: "insufficient_inventory",
    available: Math.max(item.available, 0),
  });
}

async function shiftUnits(
  tx: Transaction,
  lines: readonly UnitLine[],
  change: (line: UnitLine) => Partial<Record<"reserved" | "sold", ReturnType<typeof sql>>>,
): Promise<void> {
  for (const line of inLockOrder(lines)) {
    const updated = await tx
      .update(inventoryItems)
      .set(change(line))
      .where(and(eq(inventoryItems.id, line.inventoryItemId), sql`${inventoryItems.reserved} >= ${line.quantity}`))
      .returning({ id: inventoryItems.id });
    if (updated.length !== 1) {
      throw new AppError("INTERNAL", "Inventory invariant violated: reserved units missing.", { ...line });
    }
  }
}

/** Returns held units to availability (expiry, release). Caller guarantees this runs once per reservation. */
export function releaseUnits(tx: Transaction, lines: readonly UnitLine[]): Promise<void> {
  return shiftUnits(tx, lines, (l) => ({ reserved: sql`${inventoryItems.reserved} - ${l.quantity}` }));
}

/** Moves held units to sold on order confirmation. */
export function commitUnits(tx: Transaction, lines: readonly UnitLine[]): Promise<void> {
  return shiftUnits(tx, lines, (l) => ({
    reserved: sql`${inventoryItems.reserved} - ${l.quantity}`,
    sold: sql`${inventoryItems.sold} + ${l.quantity}`,
  }));
}
