import { runEngineeringAgent } from "@/ai";
import { aiGateway } from "@/composition/ai";
import { getDb } from "@/infrastructure/db/client";
import { json, route } from "../../../../_lib/http";
import { actorFrom, limit } from "../../../../_lib/session";

/** Runs the engineering agent (AI if configured, otherwise the runbook automation). Platform admins only. */
export const POST = route<{ incidentId: string }>(async ({ request, params, correlationId }) => {
  const actor = await actorFrom(request);
  await limit(actor, "agentRun");
  return json(await runEngineeringAgent({ db: getDb(), gateway: aiGateway(), correlationId }, actor, params.incidentId));
});
