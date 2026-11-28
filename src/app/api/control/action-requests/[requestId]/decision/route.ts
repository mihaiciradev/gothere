import { decideActionRequest } from "@/actions";
import { getDb } from "@/infrastructure/db/client";
import { json, readJson, route } from "../../../../_lib/http";
import { actorFrom, limit } from "../../../../_lib/session";

/** Body: { decision, paramsHash, note? }. Platform-scope requests only; approval executes at most once. */
export const POST = route<{ requestId: string }>(async ({ request, params, correlationId }) => {
  const actor = await actorFrom(request);
  await limit(actor, "organizerWrite");
  return json(await decideActionRequest(getDb(), actor, params.requestId, await readJson(request), { correlationId, platformOnly: true }));
});
