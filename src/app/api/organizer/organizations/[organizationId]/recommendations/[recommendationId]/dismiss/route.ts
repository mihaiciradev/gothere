import { getDb } from "@/infrastructure/db/client";
import { dismissRecommendation, getRecommendation } from "@/modules/analytics";
import { assertUuid } from "@/shared/ids";
import { json, route } from "../../../../../../_lib/http";
import { actorFrom, limit } from "../../../../../../_lib/session";

export const POST = route<{ organizationId: string; recommendationId: string }>(async ({ request, params }) => {
  const actor = await actorFrom(request);
  await limit(actor, "organizerWrite");
  assertUuid(params.organizationId, "Organization");
  const db = getDb();
  await getRecommendation(db, actor, params.recommendationId, { organizationId: params.organizationId });
  await dismissRecommendation(db, actor, params.recommendationId);
  return json({ status: "dismissed" });
});
