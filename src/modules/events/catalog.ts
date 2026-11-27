import { and, asc, count, eq, gt, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@/infrastructure/db/client";
import { events, experiences, inventoryItems } from "@/infrastructure/db/schema";
import { type ItemAvailability, getAvailabilityForEvents, getEventAvailability } from "@/modules/inventory";
import { AppError } from "@/shared/errors";
import { type AvailabilityStatus, availabilityStatus } from "./domain/availability-status";

export const eventCategories = ["festival", "concert", "club", "culture"] as const;
export type EventCategory = (typeof eventCategories)[number];

/** Public discovery filters. Every field is optional; unknown values fail validation rather than being ignored. */
export const catalogFiltersSchema = z
  .object({
    q: z.string().trim().max(80).optional(),
    category: z.enum(eventCategories).optional(),
    city: z.string().trim().max(60).optional(),
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
  })
  .strict();
export type CatalogFilters = z.infer<typeof catalogFiltersSchema>;

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

export type EventCard = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: EventCategory;
  venueName: string;
  city: string;
  countryCode: string;
  timeZone: string;
  startsAt: Date;
  endsAt: Date;
  heroImageUrl: string | null;
  heroImageCredit: string | null;
  fromPriceMinor: number | null;
  currency: string | null;
  availability: AvailabilityStatus;
  experienceCount: number;
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
const upcomingPublished = and(eq(events.status, "published"), gt(events.endsAt, sql`now()`));

function admissionsSummary(eventId: string, items: { id: string; eventId: string; kind: string; status: string }[], availability: Map<string, ItemAvailability>) {
  const sellable = items.filter((i) => i.eventId === eventId && i.kind === "admission" && i.status === "on_sale");
  const capacity = sellable.reduce((sum, i) => sum + (availability.get(i.id)?.capacity ?? 0), 0);
  const available = sellable.reduce((sum, i) => sum + (availability.get(i.id)?.available ?? 0), 0);
  return availabilityStatus(available, capacity);
}

/** Published, upcoming events matching the filters, soonest first, with price and availability summaries. */
export async function listPublishedEvents(db: DbExecutor, filters: CatalogFilters = {}): Promise<EventCard[]> {
  const f = catalogFiltersSchema.parse(filters);
  const conditions = [upcomingPublished];
  if (f.q) {
    const pattern = `%${escapeLike(f.q)}%`;
    conditions.push(
      or(
        ilike(events.title, pattern),
        ilike(events.summary, pattern),
        ilike(events.city, pattern),
        ilike(events.venueName, pattern),
        sql`EXISTS (SELECT 1 FROM experiences e WHERE e.event_id = events.id AND e.status = 'published'
              AND (e.title ILIKE ${pattern} OR e.category ILIKE ${pattern}))`,
      )!,
    );
  }
  if (f.category) conditions.push(eq(events.category, f.category));
  if (f.city) conditions.push(sql`lower(${events.city}) = lower(${f.city})`);
  if (f.month) conditions.push(sql`to_char(${events.startsAt} AT TIME ZONE ${events.timeZone}, 'YYYY-MM') = ${f.month}`);

  const rows = await db.select().from(events).where(and(...conditions)).orderBy(asc(events.startsAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [items, availability, experienceCounts] = await Promise.all([
    db
      .select({
        id: inventoryItems.id,
        eventId: inventoryItems.eventId,
        kind: inventoryItems.kind,
        status: inventoryItems.status,
        priceMinor: inventoryItems.priceMinor,
        currency: inventoryItems.currency,
      })
      .from(inventoryItems)
      .where(and(inArray(inventoryItems.eventId, ids), ne(inventoryItems.status, "draft"))),
    getAvailabilityForEvents(db, ids),
    db
      .select({ eventId: experiences.eventId, n: count() })
      .from(experiences)
      .where(and(inArray(experiences.eventId, ids), eq(experiences.status, "published")))
      .groupBy(experiences.eventId),
  ]);

  return rows.map((event) => {
    const admissions = items.filter((i) => i.eventId === event.id && i.kind === "admission" && i.status === "on_sale");
    const cheapest = admissions.reduce<(typeof admissions)[number] | undefined>(
      (min, i) => (!min || i.priceMinor < min.priceMinor ? i : min),
      undefined,
    );
    return {
      id: event.id,
      slug: event.slug,
      title: event.title,
      summary: event.summary,
      category: event.category,
      venueName: event.venueName,
      city: event.city,
      countryCode: event.countryCode,
      timeZone: event.timeZone,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      heroImageUrl: event.heroImageUrl,
      heroImageCredit: event.heroImageCredit,
      fromPriceMinor: cheapest?.priceMinor ?? null,
      currency: cheapest?.currency ?? null,
      availability: admissionsSummary(event.id, items, availability),
      experienceCount: experienceCounts.find((c) => c.eventId === event.id)?.n ?? 0,
    };
  });
}

export type ExperienceCard = {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  location: string | null;
  startsAt: Date;
  endsAt: Date;
  imageUrl: string | null;
  imageCredit: string | null;
  event: { slug: string; title: string; city: string; timeZone: string };
  priceMinor: number | null;
  currency: string | null;
  available: number;
  soldOut: boolean;
};

/** Published experiences of upcoming published events, soonest first. */
export async function listUpcomingExperiences(db: DbExecutor, limit = 12): Promise<ExperienceCard[]> {
  const rows = await db
    .select({
      experience: experiences,
      event: { id: events.id, slug: events.slug, title: events.title, city: events.city, timeZone: events.timeZone },
    })
    .from(experiences)
    .innerJoin(events, eq(events.id, experiences.eventId))
    .where(and(eq(experiences.status, "published"), upcomingPublished))
    .orderBy(asc(experiences.startsAt))
    .limit(limit);
  if (rows.length === 0) return [];

  const [items, availability] = await Promise.all([
    db
      .select()
      .from(inventoryItems)
      .where(and(inArray(inventoryItems.experienceId, rows.map((r) => r.experience.id)), ne(inventoryItems.status, "draft"))),
    getAvailabilityForEvents(db, [...new Set(rows.map((r) => r.event.id))]),
  ]);

  return rows.map(({ experience, event }) => {
    const own = items.filter((i) => i.experienceId === experience.id);
    const available = own.reduce((sum, i) => sum + (i.status === "on_sale" ? (availability.get(i.id)?.available ?? 0) : 0), 0);
    return {
      id: experience.id,
      slug: experience.slug,
      title: experience.title,
      description: experience.description,
      category: experience.category,
      location: experience.location,
      startsAt: experience.startsAt,
      endsAt: experience.endsAt,
      imageUrl: experience.imageUrl,
      imageCredit: experience.imageCredit,
      event: { slug: event.slug, title: event.title, city: event.city, timeZone: event.timeZone },
      priceMinor: own[0]?.priceMinor ?? null,
      currency: own[0]?.currency ?? null,
      available,
      soldOut: own.length > 0 && available === 0,
    };
  });
}

export type CatalogFacets = {
  categories: { value: EventCategory; count: number }[];
  cities: { value: string; count: number }[];
  months: { value: string; count: number }[];
};

/** Values that currently have at least one upcoming published event, for discovery navigation. */
export async function getCatalogFacets(db: DbExecutor): Promise<CatalogFacets> {
  const month = sql<string>`to_char(${events.startsAt} AT TIME ZONE ${events.timeZone}, 'YYYY-MM')`;
  const [categories, cities, months] = await Promise.all([
    db.select({ value: events.category, count: count() }).from(events).where(upcomingPublished).groupBy(events.category).orderBy(events.category),
    db.select({ value: events.city, count: count() }).from(events).where(upcomingPublished).groupBy(events.city).orderBy(events.city),
    db.select({ value: month, count: count() }).from(events).where(upcomingPublished).groupBy(month).orderBy(month),
  ]);
  return { categories, cities, months };
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
  const admissions = itemRows.filter((i) => i.kind === "admission").map(toItem);
  const onSale = admissions.filter((a) => a.onSale);
  const onSaleCapacity = itemRows
    .filter((i) => i.kind === "admission" && i.status === "on_sale")
    .reduce((sum, i) => sum + i.capacity, 0);

  return {
    id: event.id,
    organizationId: event.organizationId,
    slug: event.slug,
    title: event.title,
    category: event.category,
    summary: event.summary,
    description: event.description,
    venueName: event.venueName,
    city: event.city,
    countryCode: event.countryCode,
    timeZone: event.timeZone,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    heroImageUrl: event.heroImageUrl,
    heroImageCredit: event.heroImageCredit,
    fromPriceMinor: onSale.length ? Math.min(...onSale.map((a) => a.priceMinor)) : null,
    currency: onSale[0]?.currency ?? null,
    availability: availabilityStatus(
      onSale.reduce((sum, a) => sum + a.available, 0),
      onSaleCapacity,
    ),
    admissions,
    experiences: experienceRows.map((exp) => ({
      id: exp.id,
      slug: exp.slug,
      title: exp.title,
      description: exp.description,
      category: exp.category,
      location: exp.location,
      imageUrl: exp.imageUrl,
      imageCredit: exp.imageCredit,
      startsAt: exp.startsAt,
      endsAt: exp.endsAt,
      items: itemRows.filter((i) => i.experienceId === exp.id).map(toItem),
    })),
  };
}

export type PublishedEvent = Awaited<ReturnType<typeof getPublishedEvent>>;

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
    .select({
      id: events.id,
      slug: events.slug,
      title: events.title,
      venueName: events.venueName,
      city: events.city,
      timeZone: events.timeZone,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      heroImageUrl: events.heroImageUrl,
    })
    .from(events)
    .where(inArray(events.id, ids));
}
