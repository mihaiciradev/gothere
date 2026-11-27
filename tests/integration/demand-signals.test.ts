import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { demandSignals } from "@/infrastructure/db/schema";
import { joinWaitlist, recordSoldOutViews, recordUnmatchedSearch, subjectKey } from "@/modules/analytics";
import { expectDbRejection } from "./support/expect-db-error";
import { createActor, createSellableEvent, expectAppError, openTestDatabase } from "./support/fixtures";
import { SUBJECT_SECRET, soldOutTenant } from "./support/intelligence";

const { db, pool } = openTestDatabase();
afterAll(() => pool.end());
const deps = { subjectSecret: SUBJECT_SECRET };

describe("demand signals", () => {
  it("stores a waitlist request once per attendee and never stores the raw user id as the subject", async () => {
    const t = await soldOutTenant(db, 0);
    const actor = await createActor(db);
    expect(await joinWaitlist(db, actor, t.item.id, deps)).toEqual({ joined: true, alreadyJoined: false });
    expect(await joinWaitlist(db, actor, t.item.id, deps)).toEqual({ joined: true, alreadyJoined: true });
    const rows = await db.select().from(demandSignals).where(and(eq(demandSignals.inventoryItemId, t.item.id), eq(demandSignals.kind, "waitlist_request")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subjectKey).toBe(subjectKey({ userId: actor.userId }, SUBJECT_SECRET));
    expect(rows[0]!.subjectKey).not.toContain(actor.userId);
    expect(rows[0]!.organizationId).toBe(t.organization.id);
  });

  it("refuses a waitlist for items that are still available", async () => {
    const { admission } = await createSellableEvent(db, 10);
    await expectAppError(joinWaitlist(db, await createActor(db), admission.id, deps), "PRECONDITION_FAILED");
  });

  it("ignores sold-out views of items that are not sold out", async () => {
    const { admission } = await createSellableEvent(db, 10);
    expect(await recordSoldOutViews(db, { visitorId: randomUUID() }, { inventoryItemIds: [admission.id] }, deps)).toEqual({ recorded: 0 });
  });

  it("normalises unmatched searches and counts each person once a day", async () => {
    const subject = { visitorId: randomUUID() };
    const q = `Silent DISCO ${randomUUID().replace(/[^a-f]/g, "").slice(0, 6)}!!`;
    expect(await recordUnmatchedSearch(db, subject, q, deps)).toEqual({ recorded: true });
    expect(await recordUnmatchedSearch(db, subject, q.toLowerCase(), deps)).toEqual({ recorded: false });
    expect(await recordUnmatchedSearch(db, subject, "!", deps)).toEqual({ recorded: false });
  });

  it("rejects a signal whose event belongs to a different tenant than claimed", async () => {
    const a = await soldOutTenant(db, 0);
    const b = await soldOutTenant(db, 0);
    await expectDbRejection(
      db.insert(demandSignals).values({ kind: "sold_out_view", organizationId: b.organization.id, eventId: a.event.id, inventoryItemId: a.item.id, subjectKey: "x" }),
      "demand_signals_event_tenant_fk",
    );
  });
});
