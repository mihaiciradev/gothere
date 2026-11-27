import { randomBytes } from "node:crypto";
import type { Transaction } from "@/infrastructure/db/client";
import { orders, tickets } from "@/infrastructure/db/schema";
import { commitUnits, type UnitLine } from "@/modules/inventory";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32, no ambiguous characters

/** 80 bits of randomness, e.g. GT-7K2Q-9MXD-4T8P-H3VA. Unguessable; the ticket id is never the credential. */
export function generateTicketCode(): string {
  const bytes = randomBytes(10);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return `GT-${out.match(/.{4}/g)!.join("-")}`;
}

export type ConfirmableReservation = Readonly<{
  id: string;
  userId: string;
  organizationId: string;
  eventId: string;
  totalMinor: number;
  currency: string;
}>;

/**
 * Creates the order, moves units from reserved to sold and issues one ticket per unit, in the caller's
 * transaction. The caller must already have transitioned the reservation to `converted`; the unique
 * constraints on orders and on (order, item, ordinal) make a second confirmation impossible.
 */
export async function confirmOrder(
  tx: Transaction,
  params: {
    reservation: ConfirmableReservation;
    paymentAttemptId: string;
    lines: readonly UnitLine[];
    origin: "live" | "seed";
  },
) {
  const { reservation, lines } = params;
  const [order] = await tx
    .insert(orders)
    .values({
      reservationId: reservation.id,
      paymentAttemptId: params.paymentAttemptId,
      userId: reservation.userId,
      organizationId: reservation.organizationId,
      eventId: reservation.eventId,
      totalMinor: reservation.totalMinor,
      currency: reservation.currency,
      origin: params.origin,
    })
    .returning();

  await commitUnits(tx, lines);

  const issued = lines.flatMap((line) =>
    Array.from({ length: line.quantity }, (_, index) => ({
      orderId: order!.id,
      reservationId: reservation.id,
      inventoryItemId: line.inventoryItemId,
      userId: reservation.userId,
      organizationId: reservation.organizationId,
      eventId: reservation.eventId,
      ordinal: index + 1,
      code: generateTicketCode(),
    })),
  );
  await tx.insert(tickets).values(issued).onConflictDoNothing({
    target: [tickets.orderId, tickets.inventoryItemId, tickets.ordinal],
  });
  return order!;
}
