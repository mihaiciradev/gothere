import { paymentDeps } from "@/composition/runtime";
import { getDb } from "@/infrastructure/db/client";
import { startPayment } from "@/modules/payments";
import { idempotencyKey, json, kickOperations, readJson, route } from "../../../_lib/http";
import { actorFrom, limit } from "../../../_lib/session";

/** Body: { scenario? } (simulator scenarios only where enabled). Header: Idempotency-Key. The amount comes from the reservation. */
export const POST = route<{ id: string }>(async ({ request, params }) => {
  const actor = await actorFrom(request);
  await limit(actor, "paymentStart");
  const db = getDb();
  const attempt = await startPayment(db, paymentDeps(db), actor, params.id, await readJson(request), {
    idempotencyKey: idempotencyKey(request),
  });
  kickOperations();
  return json(attempt, 201);
});
