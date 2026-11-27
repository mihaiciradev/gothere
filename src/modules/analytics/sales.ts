import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/client";
import { events, experiences, inventoryItems, organizations } from "@/infrastructure/db/schema";
import type { Actor } from "@/modules/identity";
import { requireOrganizationPermission } from "@/modules/organizations";
import { AppError } from "@/shared/errors";
import { assertUuid } from "@/shared/ids";

type OriginTotals = { orders: number; tickets: number; grossMinor: number };
const emptyTotals = (): OriginTotals => ({ orders: 0, tickets: 0, grossMinor: 0 });

export type EventSalesRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  city: string;
  timeZone: string;
  startsAt: Date;
  endsAt: Date;
  admissionCapacity: number;
  admissionSold: number;
  currency: string | null;
  live: OriginTotals;
  seed: OriginTotals;
};

/** Per-event sales for one organization. Seeded history and live activity are always reported separately. */
export async function getOrganizationSales(db: DbExecutor, actor: Actor, organizationId: string) {
  assertUuid(organizationId, "Organization");
  await requireOrganizationPermission(db, actor, organizationId, "analytics.read");

  const [org] = await db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug }).from(organizations).where(eq(organizations.id, organizationId));
  const eventRows = await db
    .select({
      id: events.id,
      slug: events.slug,
      title: events.title,
      status: events.status,
      city: events.city,
      timeZone: events.timeZone,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      admissionCapacity: sql<number>`coalesce(sum(${inventoryItems.capacity}) FILTER (WHERE ${inventoryItems.kind} = 'admission'), 0)::int`,
      admissionSold: sql<number>`coalesce(sum(${inventoryItems.sold}) FILTER (WHERE ${inventoryItems.kind} = 'admission'), 0)::int`,
      currency: sql<string | null>`min(${inventoryItems.currency})`,
    })
    .from(events)
    .leftJoin(inventoryItems, eq(inventoryItems.eventId, events.id))
    .where(eq(events.organizationId, organizationId))
    .groupBy(events.id)
    .orderBy(asc(events.startsAt));

  const totals = await db.execute<{ event_id: string; origin: "seed" | "live"; orders: number; tickets: number; gross_minor: number }>(sql`
    SELECT o.event_id, o.origin, count(DISTINCT o.id)::int AS orders,
           coalesce(sum(ri.quantity), 0)::int AS tickets, coalesce(sum(ri.quantity * ri.unit_price_minor), 0)::int AS gross_minor
    FROM orders o JOIN reservation_items ri ON ri.reservation_id = o.reservation_id
    WHERE o.organization_id = ${organizationId} AND o.status = 'confirmed'
    GROUP BY o.event_id, o.origin`);

  const byEvent = new Map<string, { live: OriginTotals; seed: OriginTotals }>();
  for (const row of totals.rows) {
    const entry = byEvent.get(row.event_id) ?? { live: emptyTotals(), seed: emptyTotals() };
    entry[row.origin] = { orders: row.orders, tickets: row.tickets, grossMinor: row.gross_minor };
    byEvent.set(row.event_id, entry);
  }

  const rows: EventSalesRow[] = eventRows.map((e) => ({ ...e, ...(byEvent.get(e.id) ?? { live: emptyTotals(), seed: emptyTotals() }) }));
  const sum = (pick: (r: EventSalesRow) => OriginTotals): OriginTotals =>
    rows.reduce((acc, r) => ({ orders: acc.orders + pick(r).orders, tickets: acc.tickets + pick(r).tickets, grossMinor: acc.grossMinor + pick(r).grossMinor }), emptyTotals());

  return { organization: org!, events: rows, totals: { live: sum((r) => r.live), seed: sum((r) => r.seed) } };
}

export type OrganizationSales = Awaited<ReturnType<typeof getOrganizationSales>>;

/** Inventory, sales and unmet demand per item of one event, for its organization's members. */
export async function getEventInsights(db: DbExecutor, actor: Actor, eventId: string, options: { organizationId?: string } = {}) {
  assertUuid(eventId, "Event");
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event || (options.organizationId && event.organizationId !== options.organizationId)) throw new AppError("NOT_FOUND", "Event not found.");
  await requireOrganizationPermission(db, actor, event.organizationId, "analytics.read");

  const [items, experienceRows] = await Promise.all([
    db.execute<{
      id: string;
      kind: "admission" | "experience";
      name: string;
      status: string;
      experience_id: string | null;
      price_minor: number;
      currency: string;
      capacity: number;
      reserved: number;
      sold: number;
      waitlist: number;
      viewers: number;
      unique_interested: number;
      live_tickets: number;
      live_gross_minor: number;
      seed_tickets: number;
      seed_gross_minor: number;
    }>(sql`
      SELECT ii.id, ii.kind, ii.name, ii.status, ii.experience_id, ii.price_minor, ii.currency, ii.capacity, ii.reserved, ii.sold,
        (SELECT count(*) FROM demand_signals d WHERE d.inventory_item_id = ii.id AND d.kind = 'waitlist_request')::int AS waitlist,
        (SELECT count(DISTINCT d.subject_key) FROM demand_signals d WHERE d.inventory_item_id = ii.id AND d.kind = 'sold_out_view')::int AS viewers,
        (SELECT count(DISTINCT d.subject_key) FROM demand_signals d WHERE d.inventory_item_id = ii.id)::int AS unique_interested,
        coalesce(s.live_tickets, 0)::int AS live_tickets, coalesce(s.live_gross, 0)::int AS live_gross_minor,
        coalesce(s.seed_tickets, 0)::int AS seed_tickets, coalesce(s.seed_gross, 0)::int AS seed_gross_minor
      FROM inventory_items ii
      LEFT JOIN LATERAL (
        SELECT sum(ri.quantity) FILTER (WHERE o.origin = 'live') AS live_tickets,
               sum(ri.quantity * ri.unit_price_minor) FILTER (WHERE o.origin = 'live') AS live_gross,
               sum(ri.quantity) FILTER (WHERE o.origin = 'seed') AS seed_tickets,
               sum(ri.quantity * ri.unit_price_minor) FILTER (WHERE o.origin = 'seed') AS seed_gross
        FROM reservation_items ri JOIN orders o ON o.reservation_id = ri.reservation_id AND o.status = 'confirmed'
        WHERE ri.inventory_item_id = ii.id
      ) s ON true
      WHERE ii.event_id = ${eventId}
      ORDER BY ii.kind, ii.price_minor DESC`),
    db
      .select({
        id: experiences.id,
        slug: experiences.slug,
        title: experiences.title,
        status: experiences.status,
        origin: experiences.origin,
        startsAt: experiences.startsAt,
        endsAt: experiences.endsAt,
        publishedAt: experiences.publishedAt,
      })
      .from(experiences)
      .where(and(eq(experiences.eventId, eventId)))
      .orderBy(asc(experiences.startsAt), desc(experiences.createdAt)),
  ]);

  return {
    event: {
      id: event.id,
      organizationId: event.organizationId,
      slug: event.slug,
      title: event.title,
      status: event.status,
      city: event.city,
      venueName: event.venueName,
      timeZone: event.timeZone,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    },
    experiences: experienceRows,
    items: items.rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      status: r.status,
      experienceId: r.experience_id,
      priceMinor: r.price_minor,
      currency: r.currency,
      capacity: r.capacity,
      reserved: r.reserved,
      sold: r.sold,
      available: Math.max(0, r.capacity - r.reserved - r.sold),
      demand: { waitlist: r.waitlist, viewers: r.viewers, uniqueInterested: r.unique_interested },
      live: { tickets: r.live_tickets, grossMinor: r.live_gross_minor },
      seed: { tickets: r.seed_tickets, grossMinor: r.seed_gross_minor },
    })),
  };
}

export type EventInsights = Awaited<ReturnType<typeof getEventInsights>>;

/** Unmatched searches across the platform, most frequent first (no tenant owns a search that found nothing). */
export async function topUnmatchedSearches(db: DbExecutor, limit = 8) {
  const rows = await db.execute<{ query: string; people: number }>(sql`
    SELECT query, count(DISTINCT subject_key)::int AS people FROM demand_signals
    WHERE kind = 'search_unmatched' AND created_at > now() - interval '90 days'
    GROUP BY query ORDER BY people DESC, query LIMIT ${limit}`);
  return rows.rows;
}
