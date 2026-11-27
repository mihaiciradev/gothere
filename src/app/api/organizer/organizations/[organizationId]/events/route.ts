import { getDb } from "@/infrastructure/db/client";
import { createEvent, listOrganizationEvents } from "@/modules/events";
import { json, readJson, route } from "../../../../_lib/http";
import { actorFrom, limit } from "../../../../_lib/session";

export const GET = route<{ organizationId: string }>(async ({ request, params }) =>
  json(await listOrganizationEvents(getDb(), await actorFrom(request), params.organizationId)),
);

export const POST = route<{ organizationId: string }>(async ({ request, params }) => {
  const actor = await actorFrom(request);
  await limit(actor, "organizerWrite");
  return json(await createEvent(getDb(), actor, params.organizationId, await readJson(request)), 201);
});
