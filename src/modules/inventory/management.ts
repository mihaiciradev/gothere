import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "@/infrastructure/db/client";
import { inventoryItems } from "@/infrastructure/db/schema";
import { recordAudit } from "@/modules/audit";
import type { Actor } from "@/modules/identity";
import { requireOrganizationPermission } from "@/modules/organizations";
import { AppError } from "@/shared/errors";

export const inventoryPatchSchema = z
  .object({
    capacity: z.number().int().min(0).max(1_000_000).optional(),
    priceMinor: z.number().int().min(0).max(10_000_000).optional(),
    maxPerOrder: z.number().int().min(1).max(20).optional(),
    status: z.enum(["draft", "on_sale", "paused", "closed"]).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "Nothing to update.");

export type InventoryPatch = z.infer<typeof inventoryPatchSchema>;

export type NewInventoryItem = {
  organizationId: string;
  eventId: string;
  experienceId: string | null;
  name: string;
  description?: string | null;
  priceMinor: number;
  currency: "EUR" | "RON";
  capacity: number;
  maxPerOrder: number;
  status?: "draft" | "on_sale";
};

export async function createInventoryItem(tx: Transaction, item: NewInventoryItem) {
  const [row] = await tx
    .insert(inventoryItems)
    .values({ ...item, kind: item.experienceId ? "experience" : "admission", status: item.status ?? "draft" })
    .returning();
  return row!;
}

/** Price changes apply to new reservations only; existing reservations keep their captured price. */
export async function updateInventoryItem(db: Database, actor: Actor, inventoryItemId: string, input: unknown) {
  const patch = inventoryPatchSchema.parse(input);
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, inventoryItemId)).for("update");
    if (!item) throw new AppError("NOT_FOUND", "Inventory item not found.");
    await requireOrganizationPermission(tx, actor, item.organizationId, "inventory.write");

    if (patch.capacity !== undefined && patch.capacity < item.reserved + item.sold) {
      throw new AppError("PRECONDITION_FAILED", "Capacity cannot be lower than units already reserved or sold.", {
        committed: item.reserved + item.sold,
      });
    }
    const [updated] = await tx
      .update(inventoryItems)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(eq(inventoryItems.id, inventoryItemId))
      .returning();
    await recordAudit(tx, {
      actorType: "user",
      actorUserId: actor.userId,
      organizationId: item.organizationId,
      action: "inventory.update",
      targetType: "inventory_item",
      targetId: inventoryItemId,
      outcome: "succeeded",
      metadata: { patch },
    });
    return updated!;
  });
}
