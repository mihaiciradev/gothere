import { getDb } from "@/infrastructure/db/client";
import { getPublishedEvent } from "@/modules/events";
import { json, route } from "../../_lib/http";

export const GET = route<{ slug: string }>(async ({ params }) => json(await getPublishedEvent(getDb(), params.slug)));
