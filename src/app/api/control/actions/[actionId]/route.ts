import { getAction, invokeAction } from "@/actions";
import { getDb } from "@/infrastructure/db/client";
import { AppError } from "@/shared/errors";
import { json, readJson, route } from "../../../_lib/http";
import { actorFrom, limit } from "../../../_lib/session";

/** Human invocation of a platform-scope registry action (same executor as the agent). Body: the action's input. */
export const POST = route<{ actionId: string }>(async ({ request, params, correlationId }) => {
  const actor = await actorFrom(request);
  await limit(actor, "organizerWrite");
  if (getAction(params.actionId).scope !== "platform") throw new AppError("NOT_FOUND", "Unknown action.");
  const outcome = await invokeAction({ db: getDb(), actor, organizationId: null, initiator: "user", correlationId }, params.actionId, await readJson(request));
  return json(outcome, outcome.status === "pending_approval" ? 202 : 200);
});
