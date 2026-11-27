export const RESERVATION_TTL_SECONDS = 10 * 60;
export const MAX_ACTIVE_RESERVATIONS_PER_USER = 3;
export const MAX_LINES_PER_RESERVATION = 10;

export type ReservationStatus = "active" | "converted" | "expired" | "released";
export type ClosingStatus = Exclude<ReservationStatus, "active">;

/** active → converted | expired | released. Every other state is terminal. */
export function canTransitionReservation(from: ReservationStatus, to: ReservationStatus): boolean {
  return from === "active" && to !== "active";
}

export type ReservationRequest = Readonly<{
  eventId: string;
  items: readonly Readonly<{ inventoryItemId: string; quantity: number }>[];
}>;

/** Order-independent representation used to bind an idempotency key to its original parameters. */
export function canonicalReservationRequest(request: ReservationRequest): string {
  const items = [...request.items]
    .sort((a, b) => (a.inventoryItemId < b.inventoryItemId ? -1 : 1))
    .map((i) => [i.inventoryItemId, i.quantity]);
  return JSON.stringify({ eventId: request.eventId, items });
}
