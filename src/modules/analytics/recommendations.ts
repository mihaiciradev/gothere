import { and, desc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/client";
import { commercialRecommendations } from "@/infrastructure/db/schema";
import type { Actor } from "@/modules/identity";
import { type OrganizationPermission, requireOrganizationPermission } from "@/modules/organizations";
import { AppError } from "@/shared/errors";
import { assertUuid } from "@/shared/ids";
import {
  type Assumptions,
  type Evidence,
  type Opportunity,
  type Proposal,
  type SessionDemand,
  groundedNumbers,
  proposeAdditionalSession,
  rulesNarrative,
  ungroundedNumbers,
} from "./domain/opportunity";

type DemandRow = {
  inventory_item_id: string;
  experience_id: string;
  experience_slug: string;
  experience_title: string;
  item_name: string;
  category: string;
  location: string | null;
  description: string;
  capacity: number;
  sold: number;
  reserved: number;
  price_minor: number;
  currency: string;
  max_per_order: number;
  starts_at: Date;
  ends_at: Date;
  event_id: string;
  event_title: string;
  time_zone: string;
  event_starts_at: Date;
  event_ends_at: Date;
  waitlist: number;
  viewers: number;
  unique_interested: number;
  live_signals: number;
  seed_signals: number;
  first_signal_at: Date | null;
  last_signal_at: Date | null;
  db_now: Date;
};

/** Demand facts for every manually created experience session of the organization's upcoming published events. */
async function loadSessionDemand(db: DbExecutor, organizationId: string, eventId?: string) {
  const result = await db.execute<DemandRow>(sql`
    SELECT ii.id AS inventory_item_id, ex.id AS experience_id, ex.slug AS experience_slug, ex.title AS experience_title,
      ii.name AS item_name, ex.category, ex.location, ex.description, ii.capacity, ii.sold, ii.reserved, ii.price_minor,
      ii.currency, ii.max_per_order, ex.starts_at, ex.ends_at, ev.id AS event_id, ev.title AS event_title, ev.time_zone,
      ev.starts_at AS event_starts_at, ev.ends_at AS event_ends_at,
      count(*) FILTER (WHERE ds.kind = 'waitlist_request')::int AS waitlist,
      count(DISTINCT ds.subject_key) FILTER (WHERE ds.kind = 'sold_out_view')::int AS viewers,
      count(DISTINCT ds.subject_key)::int AS unique_interested,
      count(ds.id) FILTER (WHERE ds.origin = 'live')::int AS live_signals,
      count(ds.id) FILTER (WHERE ds.origin = 'seed')::int AS seed_signals,
      min(ds.created_at) AS first_signal_at, max(ds.created_at) AS last_signal_at, now() AS db_now
    FROM inventory_items ii
    JOIN experiences ex ON ex.id = ii.experience_id AND ex.status = 'published' AND ex.origin = 'manual'
    JOIN events ev ON ev.id = ii.event_id AND ev.status = 'published' AND ev.ends_at > now()
    LEFT JOIN demand_signals ds ON ds.inventory_item_id = ii.id AND ds.kind IN ('waitlist_request', 'sold_out_view')
    WHERE ii.organization_id = ${organizationId} AND ii.kind = 'experience' AND ii.status IN ('on_sale', 'paused')
      ${eventId ? sql`AND ev.id = ${eventId}` : sql``}
    GROUP BY ii.id, ex.id, ev.id`);
  return result.rows;
}

const asDate = (value: Date | string | null) => (value === null ? null : new Date(value));

function toSessionDemand(r: DemandRow): SessionDemand {
  return {
    inventoryItemId: r.inventory_item_id,
    experienceId: r.experience_id,
    experienceSlug: r.experience_slug,
    experienceTitle: r.experience_title,
    itemName: r.item_name,
    category: r.category,
    location: r.location,
    description: r.description,
    capacity: r.capacity,
    sold: r.sold,
    reserved: r.reserved,
    priceMinor: r.price_minor,
    currency: r.currency,
    maxPerOrder: r.max_per_order,
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
    event: { id: r.event_id, title: r.event_title, timeZone: r.time_zone, startsAt: new Date(r.event_starts_at), endsAt: new Date(r.event_ends_at) },
    waitlistRequests: r.waitlist,
    soldOutViewers: r.viewers,
    uniqueInterested: r.unique_interested,
    liveSignals: r.live_signals,
    seedSignals: r.seed_signals,
    firstSignalAt: asDate(r.first_signal_at),
    lastSignalAt: asDate(r.last_signal_at),
  };
}

export type Recommendation = {
  id: string;
  organizationId: string;
  eventId: string;
  sourceInventoryItemId: string;
  kind: string;
  status: "open" | "drafted" | "published" | "dismissed";
  evidence: Evidence;
  proposal: Proposal;
  assumptions: Assumptions;
  risks: string[];
  narrative: string;
  narrativeSource: "rules" | "ai";
  narrativeModel: string | null;
  experienceId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const toRecommendation = (row: typeof commercialRecommendations.$inferSelect) => row as unknown as Recommendation;

/**
 * Deterministic unmet-demand analysis. Finds sold-out sessions with enough distinct interest and records (or
 * refreshes) one recommendation per session. Refreshing an open recommendation replaces its numbers and resets its
 * narrative to the rules text, so a model-written narrative can never describe stale figures. Recommendations that
 * were already acted on are left untouched.
 */
export async function analyzeDemand(db: DbExecutor, actor: Actor, organizationId: string, options: { eventId?: string } = {}) {
  assertUuid(organizationId, "Organization");
  if (options.eventId) assertUuid(options.eventId, "Event");
  await requireOrganizationPermission(db, actor, organizationId, "recommendation.read");

  const rows = await loadSessionDemand(db, organizationId, options.eventId);
  const opportunities: { row: DemandRow; opportunity: Opportunity }[] = [];
  for (const row of rows) {
    const opportunity = proposeAdditionalSession(toSessionDemand(row), new Date(row.db_now));
    if (opportunity) opportunities.push({ row, opportunity });
  }

  for (const { row, opportunity } of opportunities) {
    const values = {
      evidence: opportunity.evidence,
      proposal: opportunity.proposal,
      assumptions: opportunity.assumptions,
      risks: opportunity.risks,
      narrative: rulesNarrative(opportunity),
      narrativeSource: "rules" as const,
      narrativeModel: null,
    };
    await db
      .insert(commercialRecommendations)
      .values({ organizationId, eventId: row.event_id, sourceInventoryItemId: opportunity.inventoryItemId, kind: opportunity.kind, status: "open", ...values })
      .onConflictDoUpdate({
        target: [commercialRecommendations.sourceInventoryItemId, commercialRecommendations.kind],
        set: { ...values, updatedAt: sql`now()` },
        setWhere: sql`${commercialRecommendations.status} = 'open'`,
      });
  }

  return {
    sessionsAnalyzed: rows.length,
    opportunities: opportunities.length,
    recommendations: await listRecommendationsUnchecked(db, organizationId, options.eventId),
  };
}

async function listRecommendationsUnchecked(db: DbExecutor, organizationId: string, eventId?: string) {
  const rows = await db
    .select()
    .from(commercialRecommendations)
    .where(and(eq(commercialRecommendations.organizationId, organizationId), eventId ? eq(commercialRecommendations.eventId, eventId) : undefined))
    .orderBy(desc(commercialRecommendations.updatedAt));
  return rows.map(toRecommendation);
}

export async function listRecommendations(db: DbExecutor, actor: Actor, organizationId: string) {
  assertUuid(organizationId, "Organization");
  await requireOrganizationPermission(db, actor, organizationId, "recommendation.read");
  return listRecommendationsUnchecked(db, organizationId);
}

/** Loads a recommendation for a member holding `permission`. Pass `organizationId` to pin the tenant (AI context). */
export async function getRecommendation(
  db: DbExecutor,
  actor: Actor,
  recommendationId: string,
  options: { permission?: OrganizationPermission; organizationId?: string; forUpdate?: boolean } = {},
) {
  assertUuid(recommendationId, "Recommendation");
  const query = db.select().from(commercialRecommendations).where(eq(commercialRecommendations.id, recommendationId));
  const [row] = options.forUpdate ? await query.for("update") : await query;
  if (!row || (options.organizationId && row.organizationId !== options.organizationId)) throw new AppError("NOT_FOUND", "Recommendation not found.");
  await requireOrganizationPermission(db, actor, row.organizationId, options.permission ?? "recommendation.read");
  return toRecommendation(row);
}

/**
 * Stores a model-written narrative only if every number it cites comes from the recommendation's own evidence,
 * proposal or assumptions. Returns false (and keeps the rules narrative) otherwise.
 */
export async function applyNarrative(db: DbExecutor, recommendationId: string, input: { narrative: string; model: string; basedOnUpdatedAt: Date }) {
  const [row] = await db.select().from(commercialRecommendations).where(eq(commercialRecommendations.id, recommendationId));
  if (!row || row.status !== "open") return { applied: false, reason: "not_open" as const };
  const rec = toRecommendation(row);
  const opportunity: Opportunity = { kind: "additional_session", inventoryItemId: rec.sourceInventoryItemId, evidence: rec.evidence, proposal: rec.proposal, assumptions: rec.assumptions, risks: rec.risks };
  const ungrounded = ungroundedNumbers(input.narrative, groundedNumbers(opportunity));
  if (ungrounded.length > 0) return { applied: false, reason: "ungrounded" as const, ungrounded };
  const updated = await db
    .update(commercialRecommendations)
    .set({ narrative: input.narrative.trim(), narrativeSource: "ai", narrativeModel: input.model })
    .where(
      and(
        eq(commercialRecommendations.id, recommendationId),
        eq(commercialRecommendations.status, "open"),
        // Millisecond precision: the caller's copy came through a JS Date.
        sql`date_trunc('milliseconds', ${commercialRecommendations.updatedAt}) = ${input.basedOnUpdatedAt.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: commercialRecommendations.id });
  return updated.length ? { applied: true as const } : { applied: false, reason: "stale" as const };
}

/** Links the draft created from the recommendation. Exactly once: a second draft for the same recommendation is rejected. */
export async function markRecommendationDrafted(db: DbExecutor, recommendationId: string, experienceId: string) {
  const updated = await db
    .update(commercialRecommendations)
    .set({ status: "drafted", experienceId })
    .where(and(eq(commercialRecommendations.id, recommendationId), eq(commercialRecommendations.status, "open")))
    .returning({ id: commercialRecommendations.id });
  if (updated.length === 0) throw new AppError("CONFLICT", "This recommendation already has a draft.");
}

export async function markRecommendationPublished(db: DbExecutor, experienceId: string) {
  await db
    .update(commercialRecommendations)
    .set({ status: "published" })
    .where(and(eq(commercialRecommendations.experienceId, experienceId), eq(commercialRecommendations.status, "drafted")));
}

export async function dismissRecommendation(db: DbExecutor, actor: Actor, recommendationId: string) {
  const rec = await getRecommendation(db, actor, recommendationId, { permission: "experience.write" });
  if (rec.status !== "open") throw new AppError("PRECONDITION_FAILED", "Only open recommendations can be dismissed.");
  await db.update(commercialRecommendations).set({ status: "dismissed" }).where(eq(commercialRecommendations.id, recommendationId));
}

export type RecommendationOutcome = { experienceId: string; publishedAt: Date | null; tickets: number; grossMinor: number; orders: number; capacity: number; sold: number };

/** Actual results of experiences created from recommendations: live confirmed orders only, never estimates. */
export async function recommendationOutcomes(db: DbExecutor, experienceIds: string[]): Promise<Map<string, RecommendationOutcome>> {
  if (experienceIds.length === 0) return new Map();
  const result = await db.execute<{ experience_id: string; published_at: Date | null; tickets: number; gross_minor: number; orders: number; capacity: number; sold: number }>(sql`
    SELECT ex.id AS experience_id, ex.published_at,
      coalesce(sum(ri.quantity) FILTER (WHERE o.id IS NOT NULL), 0)::int AS tickets,
      coalesce(sum(ri.quantity * ri.unit_price_minor) FILTER (WHERE o.id IS NOT NULL), 0)::int AS gross_minor,
      count(DISTINCT o.id)::int AS orders,
      coalesce(max(ii.capacity), 0)::int AS capacity, coalesce(max(ii.sold), 0)::int AS sold
    FROM experiences ex
    JOIN inventory_items ii ON ii.experience_id = ex.id
    LEFT JOIN reservation_items ri ON ri.inventory_item_id = ii.id
    LEFT JOIN orders o ON o.reservation_id = ri.reservation_id AND o.status = 'confirmed' AND o.origin = 'live'
    WHERE ex.id IN (${sql.join(experienceIds.map((id) => sql`${id}::uuid`), sql`, `)})
    GROUP BY ex.id`);
  return new Map(
    result.rows.map((r) => [
      r.experience_id,
      { experienceId: r.experience_id, publishedAt: asDate(r.published_at), tickets: r.tickets, grossMinor: r.gross_minor, orders: r.orders, capacity: r.capacity, sold: r.sold },
    ]),
  );
}
