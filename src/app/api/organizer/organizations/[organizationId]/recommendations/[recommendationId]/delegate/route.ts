import { delegateRecommendation } from "@/ai";
import { aiGateway } from "@/composition/ai";
import { getDb } from "@/infrastructure/db/client";
import { assertUuid } from "@/shared/ids";
import { json, route } from "../../../../../../_lib/http";
import { actorFrom, limit } from "../../../../../../_lib/session";

/** "Let the agent prepare it": draft + publication request through governed actions; publication awaits approval. */
export const POST = route<{ organizationId: string; recommendationId: string }>(async ({ request, params, correlationId }) => {
  const actor = await actorFrom(request);
  await limit(actor, "agentRun");
  assertUuid(params.organizationId, "Organization");
  return json(await delegateRecommendation({ db: getDb(), gateway: aiGateway(), correlationId }, actor, params.organizationId, params.recommendationId));
});
