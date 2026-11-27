import { getDb } from "@/infrastructure/db/client";
import { updateInventoryItem } from "@/modules/inventory";
import { json, readJson, route } from "../../../_lib/http";
import { actorFrom, limit } from "../../../_lib/session";

export const PATCH = route<{ inventoryItemId: string }>(async ({ request, params }) => {
  const actor = await actorFrom(request);
  await limit(actor, "organizerWrite");
  return json(await updateInventoryItem(getDb(), actor, params.inventoryItemId, await readJson(request)));
});
