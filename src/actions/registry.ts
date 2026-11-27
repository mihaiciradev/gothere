import { z } from "zod";
import {
  analyzeDemand,
  getEventInsights,
  getOrganizationSales,
  getRecommendation,
  markRecommendationDrafted,
  markRecommendationPublished,
} from "@/modules/analytics";
import {
  createExperience,
  eventCategories,
  getExperienceForOrganization,
  getPublishedEvent,
  listPublishedEvents,
  publishExperience,
} from "@/modules/events";
import { formatMinor } from "@/shared/money";
import { AppError } from "@/shared/errors";
import type { ActionDefinition, AnyAction, ExecutionContext } from "./types";

const define = <I, P, O>(definition: ActionDefinition<I, P, O>) => definition;

function requireTenant(ctx: ExecutionContext) {
  if (!ctx.actor) throw new AppError("UNAUTHENTICATED", "Sign in to continue.");
  if (!ctx.organizationId) throw new AppError("FORBIDDEN", "This action needs an organization context.");
  return { actor: ctx.actor, organizationId: ctx.organizationId };
}

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80);
const iso = (d: Date) => d.toISOString();

// ── Public discovery (attendee concierge) ───────────────────────────────────────────────────────────────────────

const searchInput = z
  .object({
    query: z.string().trim().min(1).max(80).optional().describe("Free-text match on title, summary, city, venue or experience."),
    category: z.enum(eventCategories).optional(),
    city: z.string().trim().min(1).max(60).optional(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe("YYYY-MM, in the event's local time."),
    maxPriceMinor: z.number().int().min(0).max(10_000_000).optional().describe("Cheapest admission at or below this, in minor units (cents)."),
  })
  .strict();

const eventsSearch = define({
  id: "events.search",
  title: "Search events",
  description: "Search published, upcoming events. Returns at most 8 events with real prices and availability.",
  input: searchInput,
  params: searchInput,
  risk: "LOW",
  scope: "public",
  approval: "none",
  limits: { perMinute: 30 },
  idempotency: "Read-only.",
  async execute(ctx, p) {
    const events = await listPublishedEvents(ctx.db, { q: p.query, category: p.category, city: p.city, month: p.month });
    const matching = events.filter((e) => p.maxPriceMinor === undefined || (e.fromPriceMinor !== null && e.fromPriceMinor <= p.maxPriceMinor));
    return {
      events: matching.slice(0, 8).map((e) => ({
        slug: e.slug,
        title: e.title,
        category: e.category,
        city: e.city,
        venue: e.venueName,
        startsAt: iso(e.startsAt),
        endsAt: iso(e.endsAt),
        timeZone: e.timeZone,
        fromPriceMinor: e.fromPriceMinor,
        currency: e.currency,
        availability: e.availability,
        experienceCount: e.experienceCount,
      })),
    };
  },
});

const availabilityInput = z.object({ eventSlug: slug }).strict();

const experiencesReadAvailability = define({
  id: "experiences.read_availability",
  title: "Read tickets and experiences",
  description: "Admission tickets and bookable experiences of one published event, with prices and remaining places.",
  input: availabilityInput,
  params: availabilityInput,
  risk: "LOW",
  scope: "public",
  approval: "none",
  limits: { perMinute: 30 },
  idempotency: "Read-only.",
  async execute(ctx, p) {
    const event = await getPublishedEvent(ctx.db, p.eventSlug);
    const item = (i: (typeof event.admissions)[number]) => ({
      name: i.name,
      priceMinor: i.priceMinor,
      currency: i.currency,
      available: i.available,
      soldOut: i.soldOut,
      onSale: i.onSale,
    });
    return {
      event: { slug: event.slug, title: event.title, city: event.city, startsAt: iso(event.startsAt), endsAt: iso(event.endsAt), timeZone: event.timeZone },
      admissions: event.admissions.map(item),
      experiences: event.experiences.map((x) => ({
        slug: x.slug,
        title: x.title,
        category: x.category,
        startsAt: iso(x.startsAt),
        endsAt: iso(x.endsAt),
        items: x.items.map(item),
      })),
    };
  },
});

// ── Organizer intelligence ──────────────────────────────────────────────────────────────────────────────────────

const optionalEvent = z.object({ eventId: z.uuid().optional() }).strict();

const analyticsRead = define({
  id: "analytics.read",
  title: "Read sales analytics",
  description: "Sales per event (or per item of one event), with seeded history and live activity reported separately.",
  input: optionalEvent,
  params: optionalEvent,
  risk: "LOW",
  scope: "organization",
  permission: "analytics.read",
  approval: "none",
  limits: { perMinute: 30 },
  idempotency: "Read-only.",
  async execute(ctx, p) {
    const { actor, organizationId } = requireTenant(ctx);
    if (p.eventId) {
      const insights = await getEventInsights(ctx.db, actor, p.eventId, { organizationId });
      return { event: { title: insights.event.title }, items: insights.items };
    }
    const sales = await getOrganizationSales(ctx.db, actor, organizationId);
    return { events: sales.events.map((e) => ({ id: e.id, title: e.title, admissionCapacity: e.admissionCapacity, admissionSold: e.admissionSold, live: e.live, seed: e.seed })) };
  },
});

const demandAnalyze = define({
  id: "demand.analyze",
  title: "Analyse unmet demand",
  description:
    "Deterministic analysis of sold-out sessions and the people who still want them. Records or refreshes recommendations; changes no inventory, price or listing.",
  input: optionalEvent,
  params: optionalEvent,
  risk: "LOW",
  scope: "organization",
  permission: "recommendation.read",
  approval: "none",
  limits: { perMinute: 10 },
  idempotency: "Natural: one recommendation per sold-out session; re-running refreshes open ones.",
  async execute(ctx, p) {
    const { actor, organizationId } = requireTenant(ctx);
    const result = await analyzeDemand(ctx.db, actor, organizationId, { eventId: p.eventId });
    return {
      sessionsAnalyzed: result.sessionsAnalyzed,
      recommendations: result.recommendations.map((r) => ({
        id: r.id,
        status: r.status,
        evidence: r.evidence,
        proposal: r.proposal,
        scenarios: r.assumptions.scenarios,
        risks: r.risks,
        experienceId: r.experienceId,
      })),
    };
  },
});

const draftInput = z.object({ recommendationId: z.uuid() }).strict();

const experienceCreateDraft = define({
  id: "experience.create_draft",
  title: "Create a private draft experience",
  description:
    "Creates a private, unpublished draft experience from a recommendation, using the recommendation's computed capacity, price and time. Nothing goes on sale.",
  input: draftInput,
  params: draftInput,
  risk: "MEDIUM",
  scope: "organization",
  permission: "experience.write",
  approval: "none",
  limits: { perMinute: 5 },
  idempotency: "Natural: one draft per recommendation; a repeat returns the existing draft.",
  async preconditions(ctx, p) {
    const { actor, organizationId } = requireTenant(ctx);
    const rec = await getRecommendation(ctx.db, actor, p.recommendationId, { permission: "experience.write", organizationId });
    if (rec.status === "dismissed" || rec.status === "published") {
      throw new AppError("PRECONDITION_FAILED", `This recommendation is ${rec.status}.`);
    }
  },
  async execute(ctx, p) {
    const { actor, organizationId } = requireTenant(ctx);
    return ctx.db.transaction(async (tx) => {
      const rec = await getRecommendation(tx, actor, p.recommendationId, { permission: "experience.write", organizationId, forUpdate: true });
      if (rec.status === "drafted" && rec.experienceId) {
        return { experienceId: rec.experienceId, status: "draft" as const, alreadyDrafted: true };
      }
      if (rec.status !== "open") throw new AppError("PRECONDITION_FAILED", `This recommendation is ${rec.status}.`);
      const proposal = rec.proposal;
      const { experience } = await createExperience(
        tx,
        actor,
        rec.eventId,
        {
          slug: proposal.slug,
          title: proposal.title,
          description: proposal.description,
          category: proposal.category,
          location: proposal.location ?? undefined,
          startsAt: proposal.startsAt,
          endsAt: proposal.endsAt,
          capacity: proposal.capacity,
          priceMinor: proposal.priceMinor,
          currency: proposal.currency,
          maxPerOrder: proposal.maxPerOrder,
        },
        { origin: "ai_recommendation", organizationId, audit: { ...ctx.audit, metadata: { ...ctx.audit.metadata, recommendationId: rec.id } } },
      );
      await markRecommendationDrafted(tx, rec.id, experience.id);
      return { experienceId: experience.id, status: "draft" as const, alreadyDrafted: false };
    });
  },
});

const publishInput = z.object({ experienceId: z.uuid() }).strict();
const snapshot = z
  .object({
    title: z.string(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    capacity: z.number().int(),
    priceMinor: z.number().int(),
    currency: z.string(),
    /** The event's IANA zone, so approvers read the same local time the public will see. */
    timeZone: z.string(),
  })
  .strict();
const publishParams = z.object({ experienceId: z.uuid(), snapshot }).strict();
type PublishParams = z.infer<typeof publishParams>;

async function currentSnapshot(ctx: ExecutionContext, experienceId: string) {
  const { actor, organizationId } = requireTenant(ctx);
  const { experience, item, timeZone } = await getExperienceForOrganization(ctx.db, actor, experienceId, { organizationId, permission: "experience.publish" });
  if (!item) throw new AppError("PRECONDITION_FAILED", "This experience has nothing to sell.");
  return {
    status: experience.status,
    snapshot: {
      title: experience.title,
      startsAt: iso(experience.startsAt),
      endsAt: iso(experience.endsAt),
      capacity: item.capacity,
      priceMinor: item.priceMinor,
      currency: item.currency,
      timeZone,
    },
  };
}

const experiencePublish = define({
  id: "experience.publish",
  title: "Publish an experience",
  description: "Publishes a draft experience and puts its places on sale. Requires human approval when an AI agent asks.",
  input: publishInput,
  params: publishParams,
  risk: "HIGH",
  scope: "organization",
  permission: "experience.publish",
  approval: "when_not_human",
  limits: { perMinute: 5 },
  idempotency: "Approval requests are unique per parameters; execution flips approved → executed exactly once.",
  async bind(ctx, input) {
    const current = await currentSnapshot(ctx, input.experienceId);
    return { experienceId: input.experienceId, snapshot: current.snapshot };
  },
  async preconditions(ctx, p: PublishParams) {
    const current = await currentSnapshot(ctx, p.experienceId);
    if (current.status !== "draft") throw new AppError("PRECONDITION_FAILED", `This experience is already ${current.status}.`);
    const changed = (Object.keys(p.snapshot) as (keyof PublishParams["snapshot"])[]).filter((k) => current.snapshot[k] !== p.snapshot[k]);
    if (changed.length > 0) {
      throw new AppError("PRECONDITION_FAILED", "The draft changed after this request was made; request publication again.", { changed });
    }
  },
  async execute(ctx, p: PublishParams) {
    const { actor, organizationId } = requireTenant(ctx);
    return ctx.db.transaction(async (tx) => {
      const published = await publishExperience(tx, actor, p.experienceId, { organizationId, audit: ctx.audit });
      await markRecommendationPublished(tx, p.experienceId);
      return { experienceId: published.id, status: published.status, publishedAt: published.publishedAt };
    });
  },
  describe: (p: PublishParams) =>
    `Publish “${p.snapshot.title}”: ${p.snapshot.capacity} places at ${formatMinor(p.snapshot.priceMinor, p.snapshot.currency)}.`,
});

const definitions: AnyAction[] = [eventsSearch, experiencesReadAvailability, analyticsRead, demandAnalyze, experienceCreateDraft, experiencePublish];

export const actionRegistry: ReadonlyMap<string, AnyAction> = new Map(definitions.map((d) => [d.id, d]));

export function getAction(id: string): AnyAction {
  const action = actionRegistry.get(id);
  if (!action) throw new AppError("NOT_FOUND", "Unknown action.", { actionId: id });
  return action;
}
