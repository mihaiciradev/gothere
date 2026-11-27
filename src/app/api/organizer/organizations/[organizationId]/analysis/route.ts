import { after } from "next/server";
import { invokeAction } from "@/actions";
import { writeNarratives } from "@/ai";
import { aiGateway } from "@/composition/ai";
import { getDb } from "@/infrastructure/db/client";
import { logger } from "@/infrastructure/logging/logger";
import { assertUuid } from "@/shared/ids";
import { json, readJson, route } from "../../../../_lib/http";
import { actorFrom, limit } from "../../../../_lib/session";

/** Body: { eventId? }. Runs the deterministic demand analysis; AI briefs (if configured) are written afterwards. */
export const POST = route<{ organizationId: string }>(async ({ request, params, correlationId }) => {
  const actor = await actorFrom(request);
  await limit(actor, "organizerWrite");
  assertUuid(params.organizationId, "Organization");
  const db = getDb();
  const outcome = await invokeAction({ db, actor, organizationId: params.organizationId, initiator: "user", correlationId }, "demand.analyze", await readJson(request));
  const gateway = aiGateway();
  if (gateway.available) {
    after(() => writeNarratives({ db, gateway, correlationId }, actor, params.organizationId).catch((error) => logger.warn("narratives failed", { error })));
  }
  return json(outcome);
});
