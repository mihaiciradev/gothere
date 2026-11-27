import { decideActionRequest } from "@/actions";
import { getDb } from "@/infrastructure/db/client";
import { assertUuid } from "@/shared/ids";
import { json, readJson, route } from "../../../../../../_lib/http";
import { actorFrom, limit } from "../../../../../../_lib/session";

/** Body: { decision: "approve" | "reject", paramsHash, note? }. Approval executes the action at once. */
export const POST = route<{ organizationId: string; requestId: string }>(async ({ request, params, correlationId }) => {
  const actor = await actorFrom(request);
  await limit(actor, "organizerWrite");
  assertUuid(params.organizationId, "Organization");
  return json(await decideActionRequest(getDb(), actor, params.requestId, await readJson(request), { correlationId, organizationId: params.organizationId }));
});
