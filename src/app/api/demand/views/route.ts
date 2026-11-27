import { demandSubjectSecret } from "@/composition/ai";
import { getDb } from "@/infrastructure/db/client";
import { recordSoldOutViews } from "@/modules/analytics";
import { getActor } from "@/modules/identity";
import { consumeRateLimit } from "@/modules/operations";
import { json, readJson, route } from "../../_lib/http";
import { visitorSubject, withCookie } from "../../_lib/visitor";

/** Body: { inventoryItemIds }. Sent by the event page when sold-out items are on screen. Idempotent per day. */
export const POST = route(async ({ request }) => {
  const actor = await getActor(request.headers);
  const { subject, setCookie } = visitorSubject(request, actor);
  const db = getDb();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  await consumeRateLimit(db, `demand-view:${ip}`, { limit: 60, windowSeconds: 60 });
  const result = await recordSoldOutViews(db, subject, await readJson(request), { subjectSecret: demandSubjectSecret() });
  return withCookie(json(result), setCookie);
});
