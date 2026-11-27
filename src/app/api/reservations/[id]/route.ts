import { getDb } from "@/infrastructure/db/client";
import { listPaymentAttempts } from "@/modules/payments";
import { getReservationForOwner, releaseReservation } from "@/modules/reservations";
import { findOrderForReservation } from "@/modules/ticketing";
import { json, kickOperations, route } from "../../_lib/http";
import { actorFrom } from "../../_lib/session";

export const GET = route<{ id: string }>(async ({ request, params }) => {
  const actor = await actorFrom(request);
  const db = getDb();
  const reservation = await getReservationForOwner(db, actor, params.id);
  const [payments, order] = await Promise.all([listPaymentAttempts(db, reservation.id), findOrderForReservation(db, reservation.id)]);
  // Polling a pending checkout also advances due notifications and reconciliation.
  if (payments.some((p) => p.status === "pending" || p.status === "unknown")) kickOperations();
  return json({ ...reservation, payments, orderId: order?.id ?? null });
});

export const DELETE = route<{ id: string }>(async ({ request, params }) => {
  const actor = await actorFrom(request);
  return json(await releaseReservation(getDb(), actor, params.id));
});
