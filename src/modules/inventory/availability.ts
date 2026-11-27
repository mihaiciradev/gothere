import { eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/client";
import { inventoryItems } from "@/infrastructure/db/schema";
import { availableUnits } from "./domain/availability";

export type ItemAvailability = Readonly<{
  inventoryItemId: string;
  capacity: number;
  sold: number;
  available: number;
}>;

/**
 * Read-only availability that is correct even if the expiry job is late: units held by active
 * reservations whose expiry has passed are counted as available, because no payment can confirm them.
 */
export async function getEventAvailability(db: DbExecutor, eventId: string): Promise<Map<string, ItemAvailability>> {
  const rows = await db
    .select({
      id: inventoryItems.id,
      capacity: inventoryItems.capacity,
      reserved: inventoryItems.reserved,
      sold: inventoryItems.sold,
      overdueHeld: sql<number>`coalesce((
        SELECT sum(ri.quantity)::int FROM reservation_items ri
        JOIN reservations r ON r.id = ri.reservation_id
        WHERE ri.inventory_item_id = inventory_items.id AND r.status = 'active' AND r.expires_at <= now()
      ), 0)`,
    })
    .from(inventoryItems)
    .where(eq(inventoryItems.eventId, eventId));

  return new Map(
    rows.map((r) => [
      r.id,
      { inventoryItemId: r.id, capacity: r.capacity, sold: r.sold, available: availableUnits(r) },
    ]),
  );
}
