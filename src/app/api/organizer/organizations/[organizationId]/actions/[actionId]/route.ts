import { getAction, invokeAction } from "@/actions";
import { getDb } from "@/infrastructure/db/client";
import { AppError } from "@/shared/errors";
import { assertUuid } from "@/shared/ids";
import { json, readJson, route } from "../../../../../_lib/http";
import { actorFrom, limit } from "../../../../../_lib/session";

/**
 * Human invocation of a registered organization action: the same executor, validation, authorization and audit the
 * AI tools use, with `initiator: "user"`. Body: the action's input.
 */
export const POST = route<{ organizationId: string; actionId: string }>(async ({ request, params, correlationId }) => {
  const actor = await actorFrom(request);
  await limit(actor, "organizerWrite");
  assertUuid(params.organizationId, "Organization");
  if (getAction(params.actionId).scope !== "organization") throw new AppError("NOT_FOUND", "Unknown action.");
  const outcome = await invokeAction(
    { db: getDb(), actor, organizationId: params.organizationId, initiator: "user", correlationId },
    params.actionId,
    await readJson(request),
  );
  return json(outcome, outcome.status === "pending_approval" ? 202 : 200);
});
