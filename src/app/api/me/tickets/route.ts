import { getDb } from "@/infrastructure/db/client";
import { listTicketsForUser } from "@/modules/ticketing";
import { json, route } from "../../_lib/http";
import { actorFrom } from "../../_lib/session";

export const GET = route(async ({ request }) => json(await listTicketsForUser(getDb(), await actorFrom(request))));
