import { and, asc, eq, gt, inArray, min, ne, sql } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/client";
import { events, experiences, inventoryItems } from "@/infrastructure/db/schema";
import { getEventAvailability } from "@/modules/inventory";
import { AppError } from "@/shared/errors";

export type CatalogItem = {
  id: string;
  kind: "admission" | "experience";
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  maxPerOrder: number;
  onSale: boolean;
  available: number;
  soldOut: boolean;
};

export async function listPublishedEvents(db: DbExecutor) {
  return db
    .select({
      id: events.id,
      slug: events.slug,
      title: events.title,
      summary: events.summary,
      venueName: events.venueName,
      city: events.city,
      countryCode: events.countryCode,
      timeZone: events.timeZone,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      heroImageUrl: events.heroImageUrl,
      fromPriceMinor: min(inventoryItems.priceMinor),
      currency: sql<string | null>`min(${inventoryItems.currency})`,
    })
    .from(events)
    .leftJoin(
      inventoryItems,
      and(eq(inventoryItems.eventId, events.id), eq(inventoryItems.kind, "admission"), eq(inventoryItems.status, "on_sale")),
    )
    .where(and(eq(events.status, "published"), gt(events.endsAt, sql`now()`)))
    .groupBy(events.id)
    .orderBy(asc(events.startsAt));
}

/** Public event detail: published experiences and non-draft inventory with live availability. */
export async function getPublishedEvent(db: DbExecutor, slug: string) {
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.slug, slug), eq(events.status, "published")));
  if (!event) throw new AppError("NOT_FOUND", "Event not found.");

  const [experienceRows, itemRows, availability] = await Promise.all([
    db
      .select()
      .from(experiences)
      .where(and(eq(experiences.eventId, event.id), eq(experiences.status, "published")))
      .orderBy(asc(experiences.startsAt)),
    db
      .select()
      .from(inventoryItems)
      .where(and(eq(inventoryItems.eventId, event.id), ne(inventoryItems.status, "draft")))
      .orderBy(asc(inventoryItems.priceMinor)),
    getEventAvailability(db, event.id),
  ]);

  const publishedExperienceIds = new Set(experienceRows.map((e) => e.id));
  const toItem = (row: (typeof itemRows)[number]): CatalogItem => {
    const available = availability.get(row.id)?.available ?? 0;
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      description: row.description,
      priceMinor: row.priceMinor,
      currency: row.currency,
      maxPerOrder: row.maxPerOrder,
      onSale: row.status === "on_sale",
      available,
      soldOut: row.capacity > 0 && available === 0 && row.status !== "closed",
    };
  };

  return {
    id: event.id,
    organizationId: event.organizationId,
    slug: event.slug,
    title: event.title,
    summary: event.summary,
    description: event.description,
    venueName: event.venueName,
    city: event.city,
    countryCode: event.countryCode,
    timeZone: event.timeZone,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    heroImageUrl: event.heroImageUrl,
    admissions: itemRows.filter((i) => i.kind === "admission").map(toItem),
    experiences: experienceRows.map((exp) => ({
      id: exp.id,
      slug: exp.slug,
      title: exp.title,
      description: exp.description,
      category: exp.category,
      location: exp.location,
      startsAt: exp.startsAt,
      endsAt: exp.endsAt,
      items: itemRows.filter((i) => i.experienceId === exp.id && publishedExperienceIds.has(exp.id)).map(toItem),
    })),
  };
}

/** Event status/time check used before reserving. */
export async function getEventForSale(db: DbExecutor, eventId: string) {
  const [event] = await db
    .select({
      id: events.id,
      organizationId: events.organizationId,
      status: events.status,
      ended: sql<boolean>`${events.endsAt} <= now()`,
    })
    .from(events)
    .where(eq(events.id, eventId));
  if (!event || event.status !== "published") throw new AppError("NOT_FOUND", "Event not found.");
  if (event.ended) throw new AppError("PRECONDITION_FAILED", "This event has ended.");
  return event;
}

export async function getEventsByIds(db: DbExecutor, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select({ id: events.id, slug: events.slug, title: events.title, timeZone: events.timeZone, startsAt: events.startsAt })
    .from(events)
    .where(inArray(events.id, ids));
}
