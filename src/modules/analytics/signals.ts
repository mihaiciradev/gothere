import { createHmac } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@/infrastructure/db/client";
import { demandSignals, events, inventoryItems } from "@/infrastructure/db/schema";
import type { Actor } from "@/modules/identity";
import { AppError } from "@/shared/errors";
import { assertUuid, isUuid } from "@/shared/ids";

/** Who expressed interest. Visitors are identified by a random first-party id; neither id is stored as is. */
export type DemandSubject = { userId: string } | { visitorId: string };

export type SignalDeps = { subjectSecret: string; origin?: "live" | "seed" };

/** Keyed hash, so unique interest can be counted without keeping identities in the analytics table. */
export function subjectKey(subject: DemandSubject, secret: string): string {
  const raw = "userId" in subject ? `user:${subject.userId}` : `visitor:${subject.visitorId}`;
  return createHmac("sha256", `demand-subject:${secret}`).update(raw).digest("hex").slice(0, 40);
}

/** Lowercased, punctuation-free, single-spaced; null when too short to mean anything. */
export function normalizeQuery(query: string): string | null {
  const normalized = query
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return normalized.length >= 2 ? normalized : null;
}

/** Sold-out, sellable items of published, upcoming events; anything else is not unmet demand. */
async function soldOutItems(db: DbExecutor, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select({ id: inventoryItems.id, eventId: inventoryItems.eventId, organizationId: inventoryItems.organizationId })
    .from(inventoryItems)
    .innerJoin(events, eq(events.id, inventoryItems.eventId))
    .where(
      and(
        inArray(inventoryItems.id, ids),
        inArray(inventoryItems.status, ["on_sale", "paused"]),
        eq(events.status, "published"),
        sql`${events.endsAt} > now()`,
        sql`${inventoryItems.capacity} > 0 AND ${inventoryItems.capacity} - ${inventoryItems.reserved} - ${inventoryItems.sold} <= 0`,
      ),
    );
}

/** "Notify me" on a sold-out item. Idempotent per attendee and item. */
export async function joinWaitlist(db: DbExecutor, actor: Actor, inventoryItemId: string, deps: SignalDeps) {
  assertUuid(inventoryItemId, "Item");
  const [item] = await soldOutItems(db, [inventoryItemId]);
  if (!item) throw new AppError("PRECONDITION_FAILED", "This item is not sold out, so there is no waitlist.");
  const inserted = await db
    .insert(demandSignals)
    .values({
      kind: "waitlist_request",
      organizationId: item.organizationId,
      eventId: item.eventId,
      inventoryItemId: item.id,
      subjectKey: subjectKey({ userId: actor.userId }, deps.subjectSecret),
      userId: actor.userId,
      origin: deps.origin ?? "live",
    })
    .onConflictDoNothing()
    .returning({ id: demandSignals.id });
  return { joined: true, alreadyJoined: inserted.length === 0 };
}

export async function isOnWaitlist(db: DbExecutor, actor: Actor, inventoryItemIds: string[], deps: SignalDeps) {
  const ids = inventoryItemIds.filter(isUuid);
  if (ids.length === 0) return new Set<string>();
  const rows = await db
    .select({ id: demandSignals.inventoryItemId })
    .from(demandSignals)
    .where(
      and(
        eq(demandSignals.kind, "waitlist_request"),
        eq(demandSignals.subjectKey, subjectKey({ userId: actor.userId }, deps.subjectSecret)),
        inArray(demandSignals.inventoryItemId, ids),
      ),
    );
  return new Set(rows.map((r) => r.id!));
}

export const soldOutViewSchema = z.object({ inventoryItemIds: z.array(z.uuid()).min(1).max(12) }).strict();

/** A sold-out item seen on an event page. Counted at most once per subject, item and UTC day. Non-sold-out ids are ignored. */
export async function recordSoldOutViews(db: DbExecutor, subject: DemandSubject, input: unknown, deps: SignalDeps) {
  const { inventoryItemIds } = soldOutViewSchema.parse(input);
  const items = await soldOutItems(db, [...new Set(inventoryItemIds)]);
  if (items.length === 0) return { recorded: 0 };
  const key = subjectKey(subject, deps.subjectSecret);
  const inserted = await db
    .insert(demandSignals)
    .values(
      items.map((item) => ({
        kind: "sold_out_view" as const,
        organizationId: item.organizationId,
        eventId: item.eventId,
        inventoryItemId: item.id,
        subjectKey: key,
        origin: deps.origin ?? "live",
      })),
    )
    .onConflictDoNothing()
    .returning({ id: demandSignals.id });
  return { recorded: inserted.length };
}

/** A search (catalogue or concierge) that found nothing. Platform-level: no tenant owns it. */
export async function recordUnmatchedSearch(db: DbExecutor, subject: DemandSubject, query: string, deps: SignalDeps) {
  const normalized = normalizeQuery(query);
  if (!normalized) return { recorded: false };
  const inserted = await db
    .insert(demandSignals)
    .values({
      kind: "search_unmatched",
      query: normalized,
      subjectKey: subjectKey(subject, deps.subjectSecret),
      origin: deps.origin ?? "live",
    })
    .onConflictDoNothing()
    .returning({ id: demandSignals.id });
  return { recorded: inserted.length > 0 };
}
