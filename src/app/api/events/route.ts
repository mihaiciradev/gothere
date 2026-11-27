import { getDb } from "@/infrastructure/db/client";
import { listPublishedEvents } from "@/modules/events";
import { json, route } from "../_lib/http";

/** Query: q, category, city, month (YYYY-MM). Validated by the catalogue module; unknown parameters are rejected. */
export const GET = route(async ({ request }) => {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  return json(await listPublishedEvents(getDb(), params));
});
