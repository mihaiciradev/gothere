import { getDb } from "@/infrastructure/db/client";
import { getTicketForUser } from "@/modules/ticketing";
import { json, route } from "../../../_lib/http";
import { actorFrom } from "../../../_lib/session";

export const GET = route<{ id: string }>(async ({ request, params }) =>
  json(await getTicketForUser(getDb(), await actorFrom(request), params.id)),
);
