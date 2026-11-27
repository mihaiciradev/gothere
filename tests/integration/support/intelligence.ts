import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { ActionContext, Initiator } from "@/actions";
import type { AiProvider, AiTurnRequest, AiTurnResponse } from "@/ai";
import type { Database } from "@/infrastructure/db/client";
import { inventoryItems } from "@/infrastructure/db/schema";
import { recordSoldOutViews } from "@/modules/analytics";
import type { Actor } from "@/modules/identity";
import { actorFor, addMember, createEvent, createExperienceItem, createOrganization, createUser } from "./fixtures";

export const SUBJECT_SECRET = "test-subject-secret-test-subject-secret";

/** A tenant with owner/manager/analyst and an upcoming published event whose 10-place session is sold out. */
export async function soldOutTenant(db: Database, interested = 30) {
  const organization = await createOrganization(db);
  const event = await createEvent(db, organization.id);
  const { experience, item } = await createExperienceItem(db, event, 10);
  await db.update(inventoryItems).set({ sold: 10 }).where(eq(inventoryItems.id, item.id));
  for (let i = 0; i < interested; i++) {
    await recordSoldOutViews(db, { visitorId: randomUUID() }, { inventoryItemIds: [item.id] }, { subjectSecret: SUBJECT_SECRET });
  }
  const member = async (role: "owner" | "manager" | "analyst") => {
    const user = await createUser(db);
    await addMember(db, organization.id, user.id, role);
    return actorFor(user);
  };
  return { organization, event, experience, item, owner: await member("owner"), manager: await member("manager"), analyst: await member("analyst") };
}

export function ctx(db: Database, actor: Actor | null, organizationId: string | null, initiator: Initiator = "user"): ActionContext {
  return { db, actor, organizationId, initiator };
}

type Script = (request: AiTurnRequest, turn: number) => AiTurnResponse | Promise<AiTurnResponse>;

/** Scripted stand-in for a model. Records every request it receives. */
export function fakeProvider(script: Script, model = "fake-haiku"): AiProvider & { requests: AiTurnRequest[] } {
  const requests: AiTurnRequest[] = [];
  return {
    name: "fake",
    model,
    requests,
    async complete(request) {
      requests.push(structuredClone({ ...request, signal: undefined as unknown as AbortSignal }));
      return script(request, requests.length - 1);
    },
  };
}

export const toolCall = (name: string, input: unknown, id = randomUUID()): AiTurnResponse => ({
  stopReason: "tool_use",
  message: { role: "assistant", content: [{ type: "tool_call", id, name, input }] },
  usage: { inputTokens: 1200, outputTokens: 80 },
});

/** The last tool results the model was sent, parsed. */
export function lastToolResults(request: AiTurnRequest): { isError?: boolean; body: Record<string, unknown> }[] {
  const last = request.messages.at(-1)!;
  return last.content.flatMap((b) => (b.type === "tool_result" ? [{ isError: b.isError, body: JSON.parse(b.content) as Record<string, unknown> }] : []));
}
