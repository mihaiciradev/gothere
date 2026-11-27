import { getDb } from "@/infrastructure/db/client";
import { createReservation } from "@/modules/reservations";
import { idempotencyKey, json, readJson, route } from "../_lib/http";
import { actorFrom, limit } from "../_lib/session";

/** Body: { eventId, items: [{ inventoryItemId, quantity }] }. Header: Idempotency-Key. Prices are never accepted. */
export const POST = route(async ({ request }) => {
  const actor = await actorFrom(request);
  await limit(actor, "reservationCreate");
  const reservation = await createReservation(getDb(), actor, await readJson(request), {
    idempotencyKey: idempotencyKey(request),
  });
  return json(reservation, 201);
});
