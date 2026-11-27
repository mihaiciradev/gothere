import { getDb } from "@/infrastructure/db/client";
import { publishExperience } from "@/modules/events";
import { json, route } from "../../../../_lib/http";
import { actorFrom, limit } from "../../../../_lib/session";

export const POST = route<{ experienceId: string }>(async ({ request, params }) => {
  const actor = await actorFrom(request);
  await limit(actor, "organizerWrite");
  return json(await publishExperience(getDb(), actor, params.experienceId));
});
