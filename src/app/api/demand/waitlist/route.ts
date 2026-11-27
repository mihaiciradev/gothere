import { z } from "zod";
import { demandSubjectSecret } from "@/composition/ai";
import { getDb } from "@/infrastructure/db/client";
import { joinWaitlist } from "@/modules/analytics";
import { json, readJson, route } from "../../_lib/http";
import { actorFrom, limit } from "../../_lib/session";

const body = z.object({ inventoryItemId: z.uuid() }).strict();

/** Body: { inventoryItemId }. "Notify me" for a sold-out item; signed-in attendees only. */
export const POST = route(async ({ request }) => {
  const actor = await actorFrom(request);
  await limit(actor, "demandWrite");
  const { inventoryItemId } = body.parse(await readJson(request));
  return json(await joinWaitlist(getDb(), actor, inventoryItemId, { subjectSecret: demandSubjectSecret() }));
});
