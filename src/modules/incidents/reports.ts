import { sql } from "drizzle-orm";
import type { Database } from "@/infrastructure/db/client";
import { isAppError } from "@/shared/errors";
import { stackFrames } from "./domain/sanitize";
import { recordOperationalEvent } from "./recorder";

/** Event for a reservation the expiry sweep had to skip, with the held units and their price (commercial impact). */
export async function reportReservationExpiryFailure(db: Database, reservationId: string, error: unknown) {
  const lines = await db.execute<{ inventory_item_id: string; quantity: number; unit_price_minor: number; currency: string }>(sql`
    SELECT ri.inventory_item_id, ri.quantity, ri.unit_price_minor, r.currency
    FROM reservation_items ri JOIN reservations r ON r.id = ri.reservation_id
    WHERE ri.reservation_id = ${reservationId}`);
  for (const line of lines.rows) {
    await recordOperationalEvent(db, {
      kind: "reservations.expiry_failed",
      message: `Overdue hold could not be expired: ${error instanceof Error ? error.message : String(error)}`,
      context: {
        reservationId,
        inventoryItemId: line.inventory_item_id,
        quantity: line.quantity,
        unitPriceMinor: line.unit_price_minor,
        currency: line.currency,
        errorCode: isAppError(error) ? error.code : null,
        frames: stackFrames(error),
      },
      fingerprintParts: [line.inventory_item_id],
      dedupeKey: `${reservationId}:${line.inventory_item_id}:${new Date().toISOString().slice(0, 10)}`,
    });
  }
}

export async function reportStageFailure(db: Database, stage: string, error: unknown) {
  await recordOperationalEvent(db, {
    kind: "operations.stage_failed",
    message: `${stage} failed: ${error instanceof Error ? error.message : String(error)}`,
    context: { stage, errorName: error instanceof Error ? error.name : typeof error, frames: stackFrames(error) },
    fingerprintParts: [stage],
  });
}
