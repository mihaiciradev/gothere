import { z } from "zod";
import { MAX_LINES_PER_RESERVATION } from "./domain/policy";

/** Prices, currency and totals are deliberately absent: the server reads them from inventory. Unknown keys are rejected. */
export const createReservationSchema = z
  .object({
    eventId: z.uuid(),
    items: z
      .array(z.object({ inventoryItemId: z.uuid(), quantity: z.number().int().min(1).max(20) }).strict())
      .min(1)
      .max(MAX_LINES_PER_RESERVATION)
      .refine((items) => new Set(items.map((i) => i.inventoryItemId)).size === items.length, "Each ticket type may appear once."),
  })
  .strict();

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "Idempotency-Key may contain letters, digits and . _ : - only.");
