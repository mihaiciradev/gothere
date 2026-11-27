import { getDb } from "@/infrastructure/db/client";
import { createExperience } from "@/modules/events";
import { json, readJson, route } from "../../../../_lib/http";
import { actorFrom, limit } from "../../../../_lib/session";

/** Creates a draft experience and its draft inventory. Publishing is a separate, separately permissioned step. */
export const POST = route<{ eventId: string }>(async ({ request, params }) => {
  const actor = await actorFrom(request);
  await limit(actor, "organizerWrite");
  return json(await createExperience(getDb(), actor, params.eventId, await readJson(request)), 201);
});
