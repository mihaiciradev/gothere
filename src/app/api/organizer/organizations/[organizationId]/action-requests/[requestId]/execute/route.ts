import { executeApprovedRequest } from "@/actions";
import { getDb } from "@/infrastructure/db/client";
import { assertUuid } from "@/shared/ids";
import { json, route } from "../../../../../../_lib/http";
import { actorFrom, limit } from "../../../../../../_lib/session";

/** Retries execution of a request this approver already approved (e.g. after a dropped connection). Exactly once. */
export const POST = route<{ organizationId: string; requestId: string }>(async ({ request, params, correlationId }) => {
  const actor = await actorFrom(request);
  await limit(actor, "organizerWrite");
  assertUuid(params.organizationId, "Organization");
  return json(await executeApprovedRequest(getDb(), actor, params.requestId, { correlationId, organizationId: params.organizationId }));
});
