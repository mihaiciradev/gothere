import { getDb } from "@/infrastructure/db/client";
import { changeIncidentStatus } from "@/modules/incidents";
import { json, readJson, route } from "../../../../_lib/http";
import { actorFrom, limit } from "../../../../_lib/session";

/** Body: { status: "investigating" | "mitigated" | "resolved", note? }. Platform admins only. */
export const POST = route<{ incidentId: string }>(async ({ request, params, correlationId }) => {
  const actor = await actorFrom(request);
  await limit(actor, "organizerWrite");
  return json(await changeIncidentStatus(getDb(), actor, params.incidentId, await readJson(request), { correlationId }));
});
