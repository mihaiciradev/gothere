import { z } from "zod";
import { demandSubjectSecret } from "@/composition/ai";
import { getDb } from "@/infrastructure/db/client";
import { recordUnmatchedSearch } from "@/modules/analytics";
import { listPublishedEvents } from "@/modules/events";
import { getActor } from "@/modules/identity";
import { consumeRateLimit } from "@/modules/operations";
import { json, readJson, route } from "../../_lib/http";
import { visitorSubject, withCookie } from "../../_lib/visitor";

const body = z.object({ query: z.string().trim().min(2).max(80) }).strict();

/** Body: { query }. Recorded only if the catalogue really has no match for it (checked here, not trusted). */
export const POST = route(async ({ request }) => {
  const actor = await getActor(request.headers);
  const { subject, setCookie } = visitorSubject(request, actor);
  const db = getDb();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  await consumeRateLimit(db, `demand-search:${ip}`, { limit: 20, windowSeconds: 60 });
  const { query } = body.parse(await readJson(request));
  const matches = await listPublishedEvents(db, { q: query });
  const result = matches.length === 0 ? await recordUnmatchedSearch(db, subject, query, { subjectSecret: demandSubjectSecret() }) : { recorded: false };
  return withCookie(json(result), setCookie);
});
