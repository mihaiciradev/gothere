import { getDb } from "@/infrastructure/db/client";
import { updateEvent } from "@/modules/events";
import { json, readJson, route } from "../../../_lib/http";
import { actorFrom, limit } from "../../../_lib/session";

export const PATCH = route<{ eventId: string }>(async ({ request, params }) => {
  const actor = await actorFrom(request);
  await limit(actor, "organizerWrite");
  return json(await updateEvent(getDb(), actor, params.eventId, await readJson(request)));
});
