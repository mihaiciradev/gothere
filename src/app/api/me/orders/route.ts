import { getDb } from "@/infrastructure/db/client";
import { listOrdersForUser } from "@/modules/ticketing";
import { json, route } from "../../_lib/http";
import { actorFrom } from "../../_lib/session";

export const GET = route(async ({ request }) => json(await listOrdersForUser(getDb(), await actorFrom(request))));
