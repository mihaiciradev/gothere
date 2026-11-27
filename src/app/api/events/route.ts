import { getDb } from "@/infrastructure/db/client";
import { listPublishedEvents } from "@/modules/events";
import { json, route } from "../_lib/http";

export const GET = route(async () => json(await listPublishedEvents(getDb())));
