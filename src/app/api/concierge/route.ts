import { askConcierge } from "@/ai";
import { aiGateway, demandSubjectSecret } from "@/composition/ai";
import { getDb } from "@/infrastructure/db/client";
import { getActor } from "@/modules/identity";
import { consumeRateLimit } from "@/modules/operations";
import { json, readJson, route } from "../_lib/http";
import { visitorSubject, withCookie } from "../_lib/visitor";

/** Body: { message }. Works signed in or out; falls back to deterministic search whenever AI is unavailable. */
export const POST = route(async ({ request }) => {
  const actor = await getActor(request.headers);
  const { subject, setCookie } = visitorSubject(request, actor);
  const db = getDb();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  await consumeRateLimit(db, `concierge:${ip}`, { limit: 30, windowSeconds: 60 });
  const answer = await askConcierge({ db, gateway: aiGateway(), subjectSecret: demandSubjectSecret() }, await readJson(request), { actor, subject });
  return withCookie(json(answer), setCookie);
});
