import { getDb } from "@/infrastructure/db/client";
import { serverEnv } from "@/infrastructure/env";
import { createSimulatedIncident } from "@/modules/incidents";
import { json, readJson, route } from "../../_lib/http";
import { actorFrom, limit } from "../../_lib/session";

/** Body: { scenario }. Creates a labelled simulated incident (records only). Never in production. */
export const POST = route(async ({ request, correlationId }) => {
  const actor = await actorFrom(request);
  await limit(actor, "organizerWrite");
  const allowed = serverEnv().APP_ENV !== "production";
  return json(await createSimulatedIncident(getDb(), actor, await readJson(request), { allowed, correlationId }), 201);
});
