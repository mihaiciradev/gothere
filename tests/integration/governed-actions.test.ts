import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { decideActionRequest, executeApprovedRequest, invokeAction, paramsHash } from "@/actions";
import { actionRequests, auditRecords, commercialRecommendations, experiences, inventoryItems } from "@/infrastructure/db/schema";
import { analyzeDemand } from "@/modules/analytics";
import { createExperience, getPublishedEvent } from "@/modules/events";
import { expectDbRejection } from "./support/expect-db-error";
import { createActor, expectAppError, openTestDatabase } from "./support/fixtures";
import { ctx, soldOutTenant } from "./support/intelligence";

const { db, pool } = openTestDatabase();
afterAll(() => pool.end());

async function recommendationFor(t: Awaited<ReturnType<typeof soldOutTenant>>) {
  const outcome = await invokeAction(ctx(db, t.analyst, t.organization.id), "demand.analyze", {});
  if (outcome.status !== "executed") throw new Error("analysis should execute");
  const recs = (outcome.output as { recommendations: { id: string; status: string; proposal: Record<string, number | string> }[] }).recommendations;
  expect(recs).toHaveLength(1);
  return recs[0]!;
}

/** AI drafts from the recommendation and asks for publication; returns the pending request. */
async function pendingPublication(t: Awaited<ReturnType<typeof soldOutTenant>>) {
  const rec = await recommendationFor(t);
  const draft = await invokeAction(ctx(db, t.manager, t.organization.id, "ai_agent"), "experience.create_draft", { recommendationId: rec.id });
  if (draft.status !== "executed") throw new Error("draft should execute");
  const experienceId = (draft.output as { experienceId: string }).experienceId;
  const publish = await invokeAction(ctx(db, t.manager, t.organization.id, "ai_agent"), "experience.publish", { experienceId });
  if (publish.status !== "pending_approval") throw new Error("publication should wait for approval");
  return { rec, experienceId, request: publish.request };
}

const experienceRow = async (id: string) => (await db.select().from(experiences).where(eq(experiences.id, id)))[0]!;
const requestRow = async (id: string) => (await db.select().from(actionRequests).where(eq(actionRequests.id, id)))[0]!;

describe("unmet-demand analysis", () => {
  it("turns distinct interest in a sold-out session into a deterministic, idempotent proposal", async () => {
    const t = await soldOutTenant(db, 30);
    const first = await analyzeDemand(db, t.analyst, t.organization.id);
    const second = await analyzeDemand(db, t.analyst, t.organization.id);
    expect(second.recommendations).toHaveLength(1);
    expect(second.recommendations[0]!.id).toBe(first.recommendations[0]!.id);

    const rec = second.recommendations[0]!;
    expect(rec.evidence).toMatchObject({ capacity: 10, sold: 10, available: 0, uniqueInterested: 30, soldOutViewers: 30, waitlistRequests: 0 });
    // 30 interested ≥ 2 × 10 places → 15% premium on EUR 35, rounded to EUR 5 → EUR 40.
    expect(rec.proposal).toMatchObject({ capacity: 10, priceMinor: 4000, currency: "EUR", maxGrossMinor: 40_000 });
    expect(rec.proposal.startsAt).toBe("2030-07-02T18:00:00.000Z");
    expect(rec.assumptions.scenarios.map((s) => s.tickets)).toEqual([7, 10, 10]);
    expect(rec.narrativeSource).toBe("rules");
  });

  it("does not recommend anything for thin interest", async () => {
    const t = await soldOutTenant(db, 5);
    expect((await analyzeDemand(db, t.owner, t.organization.id)).recommendations).toHaveLength(0);
  });

  it("counts a repeated view by the same person once per day", async () => {
    const t = await soldOutTenant(db, 25);
    const [{ n }] = (await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM demand_signals WHERE inventory_item_id = ${t.item.id}`)).rows as [{ n: number }];
    expect(n).toBe(25);
  });
});

describe("authorization of actions", () => {
  it("rejects actions from non-members and from roles without the permission, and audits the denial", async () => {
    const t = await soldOutTenant(db);
    const rec = await recommendationFor(t);
    const outsider = await createActor(db);
    await expectAppError(invokeAction(ctx(db, outsider, t.organization.id, "ai_agent"), "demand.analyze", {}), "NOT_FOUND");
    await expectAppError(invokeAction(ctx(db, t.analyst, t.organization.id, "ai_agent"), "experience.create_draft", { recommendationId: rec.id }), "FORBIDDEN");
    await expectAppError(invokeAction(ctx(db, null, t.organization.id, "ai_agent"), "demand.analyze", {}), "UNAUTHENTICATED");

    const denials = await db
      .select()
      .from(auditRecords)
      .where(and(eq(auditRecords.organizationId, t.organization.id), eq(auditRecords.outcome, "denied")));
    expect(denials.map((d) => d.actorType)).toEqual(expect.arrayContaining(["ai_agent"]));
    expect(denials.length).toBeGreaterThanOrEqual(3);
  });

  it("pins resources to the context tenant: an agent of one organization cannot touch another's", async () => {
    const a = await soldOutTenant(db);
    const b = await soldOutTenant(db);
    const recB = await recommendationFor(b);
    // The same person may belong to both; the tenant comes from the context, never from the input.
    const both = a.owner;
    await db.execute(sql`INSERT INTO organization_memberships (organization_id, user_id, role) VALUES (${b.organization.id}, ${both.userId}, 'owner')`);
    await expectAppError(invokeAction(ctx(db, both, a.organization.id, "ai_agent"), "experience.create_draft", { recommendationId: recB.id }), "NOT_FOUND");
  });

  it("rejects unknown keys and invalid input before anything else", async () => {
    const t = await soldOutTenant(db);
    await expectAppError(invokeAction(ctx(db, t.owner, t.organization.id, "ai_agent"), "demand.analyze", { organizationId: crypto.randomUUID() }), "VALIDATION_FAILED");
    await expectAppError(invokeAction(ctx(db, t.owner, t.organization.id, "ai_agent"), "no.such_action", {}), "NOT_FOUND");
  });
});

describe("approval of high-risk actions", () => {
  it("lets an agent create a private draft but holds publication for a human", async () => {
    const t = await soldOutTenant(db);
    const { rec, experienceId, request } = await pendingPublication(t);

    expect((await experienceRow(experienceId)).status).toBe("draft");
    expect((await experienceRow(experienceId)).origin).toBe("ai_recommendation");
    const publicEvent = await getPublishedEvent(db, t.event.slug);
    expect(publicEvent.experiences.map((e) => e.id)).not.toContain(experienceId);

    const stored = await requestRow(request.id);
    expect(stored).toMatchObject({ status: "pending_approval", initiator: "ai_agent", risk: "HIGH", actionId: "experience.publish" });
    expect(stored.params).toMatchObject({ experienceId, snapshot: { capacity: 10, priceMinor: 4000, currency: "EUR" } });
    expect(stored.paramsHash).toBe(paramsHash(stored.params));

    // Asking again with the same parameters returns the same open request.
    const again = await invokeAction(ctx(db, t.manager, t.organization.id, "ai_agent"), "experience.publish", { experienceId });
    expect(again.status === "pending_approval" && again.request).toMatchObject({ id: request.id, duplicate: true });
    // So does drafting again: one draft per recommendation.
    const redraft = await invokeAction(ctx(db, t.manager, t.organization.id, "ai_agent"), "experience.create_draft", { recommendationId: rec.id });
    expect(redraft.status === "executed" && redraft.output).toMatchObject({ experienceId, alreadyDrafted: true });

    const draftAudit = await db.select().from(auditRecords).where(and(eq(auditRecords.targetId, experienceId), eq(auditRecords.action, "experience.create_draft")));
    expect(draftAudit[0]).toMatchObject({ actorType: "ai_agent", actorUserId: t.manager.userId });
  });

  it("publishes human-initiated requests directly: the human is the accountable decision-maker", async () => {
    const t = await soldOutTenant(db);
    const rec = await recommendationFor(t);
    const draft = await invokeAction(ctx(db, t.manager, t.organization.id), "experience.create_draft", { recommendationId: rec.id });
    const experienceId = (draft as { output: { experienceId: string } }).output.experienceId;
    const publish = await invokeAction(ctx(db, t.manager, t.organization.id), "experience.publish", { experienceId });
    expect(publish.status).toBe("executed");
    expect((await experienceRow(experienceId)).status).toBe("published");
  });

  it("requires the approver to hold both action.approve and the action's permission", async () => {
    const t = await soldOutTenant(db);
    const { request } = await pendingPublication(t);
    await expectAppError(decideActionRequest(db, t.analyst, request.id, { decision: "approve", paramsHash: request.paramsHash }), "FORBIDDEN");
    const outsider = await createActor(db);
    await expectAppError(decideActionRequest(db, outsider, request.id, { decision: "approve", paramsHash: request.paramsHash }), "NOT_FOUND");
    expect((await requestRow(request.id)).status).toBe("pending_approval");
  });

  it("executes exactly the approved parameters, once, and records who approved", async () => {
    const t = await soldOutTenant(db);
    const { rec, experienceId, request } = await pendingPublication(t);

    const result = await decideActionRequest(db, t.owner, request.id, { decision: "approve", paramsHash: request.paramsHash, note: "Crew confirmed" });
    expect(result.status).toBe("executed");
    expect((await experienceRow(experienceId)).status).toBe("published");
    const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.experienceId, experienceId));
    expect(item).toMatchObject({ status: "on_sale", capacity: 10, priceMinor: 4000 });
    const [recRow] = await db.select().from(commercialRecommendations).where(eq(commercialRecommendations.id, rec.id));
    expect(recRow!.status).toBe("published");

    const stored = await requestRow(request.id);
    expect(stored).toMatchObject({ status: "executed", decidedByUserId: t.owner.userId, decisionNote: "Crew confirmed" });
    const [publishAudit] = await db.select().from(auditRecords).where(and(eq(auditRecords.targetId, experienceId), eq(auditRecords.action, "experience.publish")));
    expect(publishAudit).toMatchObject({ actorType: "user", actorUserId: t.owner.userId });
    expect(publishAudit!.metadata).toMatchObject({ actionRequestId: request.id, initiator: "ai_agent", requestedBy: t.manager.userId });

    // Replays change nothing.
    await expectAppError(executeApprovedRequest(db, t.owner, request.id), "CONFLICT");
    await expectAppError(decideActionRequest(db, t.owner, request.id, { decision: "approve", paramsHash: request.paramsHash }), "CONFLICT");
    const publishes = await db.select().from(auditRecords).where(and(eq(auditRecords.targetId, experienceId), eq(auditRecords.action, "experience.publish")));
    expect(publishes).toHaveLength(1);
  });

  it("rejects an approval for parameters other than the ones reviewed", async () => {
    const t = await soldOutTenant(db);
    const { experienceId, request } = await pendingPublication(t);
    const forged = paramsHash({ experienceId, snapshot: { title: "x", startsAt: "2030-07-02T18:00:00.000Z", endsAt: "2030-07-02T19:00:00.000Z", capacity: 10, priceMinor: 1, currency: "EUR" } });
    await expectAppError(decideActionRequest(db, t.owner, request.id, { decision: "approve", paramsHash: forged }), "CONFLICT");
    expect((await requestRow(request.id)).status).toBe("pending_approval");
    expect((await experienceRow(experienceId)).status).toBe("draft");
  });

  it("makes stored parameters immutable in the database", async () => {
    const t = await soldOutTenant(db);
    const { request } = await pendingPublication(t);
    await expectDbRejection(
      db.update(actionRequests).set({ params: { experienceId: crypto.randomUUID() } }).where(eq(actionRequests.id, request.id)),
      "action_requests_immutable",
    );
    await expectDbRejection(db.update(actionRequests).set({ status: "executed", executedAt: new Date() }).where(eq(actionRequests.id, request.id)), "action_requests_status_transition");
    await expectDbRejection(db.delete(actionRequests).where(eq(actionRequests.id, request.id)), "action_requests_no_delete");
  });

  it("refuses to publish a draft that changed after the request, and marks the request failed", async () => {
    const t = await soldOutTenant(db);
    const { experienceId, request } = await pendingPublication(t);
    await db.update(inventoryItems).set({ priceMinor: 9900 }).where(eq(inventoryItems.experienceId, experienceId));
    const result = await decideActionRequest(db, t.owner, request.id, { decision: "approve", paramsHash: request.paramsHash });
    expect(result).toMatchObject({ status: "failed", error: { code: "PRECONDITION_FAILED" } });
    expect((await experienceRow(experienceId)).status).toBe("draft");
    expect((await requestRow(request.id)).status).toBe("failed");
  });

  it("expires requests that were not decided in time", async () => {
    const t = await soldOutTenant(db);
    const { request } = await pendingPublication(t);
    await db.update(actionRequests).set({ expiresAt: sql`now() - interval '1 minute'` }).where(eq(actionRequests.id, request.id));
    await expectAppError(decideActionRequest(db, t.owner, request.id, { decision: "approve", paramsHash: request.paramsHash }), "PRECONDITION_FAILED");
    expect((await requestRow(request.id)).status).toBe("expired");
  });

  it("executes an approved request exactly once under concurrent execution", async () => {
    const t = await soldOutTenant(db);
    const { experienceId, request } = await pendingPublication(t);
    await db
      .update(actionRequests)
      .set({ status: "approved", decidedByUserId: t.owner.userId, decidedAt: new Date() })
      .where(eq(actionRequests.id, request.id));

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => executeApprovedRequest(db, t.owner, request.id)));
    expect(results.filter((r) => r.status === "fulfilled" && r.value.status === "executed")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(4);
    expect((await experienceRow(experienceId)).status).toBe("published");
  });

  it("lets only the approver execute an approved request", async () => {
    const t = await soldOutTenant(db);
    const { request } = await pendingPublication(t);
    await db.update(actionRequests).set({ status: "approved", decidedByUserId: t.owner.userId, decidedAt: new Date() }).where(eq(actionRequests.id, request.id));
    await expectAppError(executeApprovedRequest(db, t.manager, request.id), "FORBIDDEN");
    expect((await requestRow(request.id)).status).toBe("approved");
  });

  it("re-checks the requester's permission at execution time", async () => {
    const t = await soldOutTenant(db);
    const { experienceId, request } = await pendingPublication(t);
    await db.execute(sql`DELETE FROM organization_memberships WHERE organization_id = ${t.organization.id} AND user_id = ${t.manager.userId}`);
    const result = await decideActionRequest(db, t.owner, request.id, { decision: "approve", paramsHash: request.paramsHash });
    expect(result.status).toBe("failed");
    expect((await experienceRow(experienceId)).status).toBe("draft");
  });

  it("holds publication of manually created drafts too when an agent asks", async () => {
    const t = await soldOutTenant(db);
    const { experience } = await createExperience(db, t.manager, t.event.id, {
      slug: `manual-${crypto.randomUUID().slice(0, 6)}`,
      title: "Manual draft",
      description: "A manual draft",
      category: "music",
      startsAt: "2030-07-02T10:00:00Z",
      endsAt: "2030-07-02T11:00:00Z",
      capacity: 20,
      priceMinor: 1500,
    });
    const outcome = await invokeAction(ctx(db, t.manager, t.organization.id, "automation"), "experience.publish", { experienceId: experience.id });
    expect(outcome.status).toBe("pending_approval");
  });
});
