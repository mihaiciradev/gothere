import { and, desc, eq, sql } from "drizzle-orm";
import type { Database, DbExecutor } from "@/infrastructure/db/client";
import { isUniqueViolation } from "@/infrastructure/db/errors";
import { events, experiences, inventoryItems } from "@/infrastructure/db/schema";
import { recordAudit } from "@/modules/audit";
import type { Actor } from "@/modules/identity";
import { createInventoryItem } from "@/modules/inventory";
import { requireOrganizationPermission } from "@/modules/organizations";
import { AppError } from "@/shared/errors";
import { assertUuid } from "@/shared/ids";
import { assertEventTransition, assertExperienceTransition, canHostPublishedExperience } from "./domain/lifecycle";
import { createEventSchema, createExperienceSchema, updateEventSchema } from "./schemas";

/** Who the change is attributed to. Actions invoked by an AI agent or automation still act with a user's rights. */
export type AuditAttribution = { actorType?: "user" | "ai_agent" | "system"; correlationId?: string; metadata?: Record<string, unknown> };

function audit(
  actor: Actor,
  organizationId: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
  attribution: AuditAttribution = {},
) {
  return {
    actorType: attribution.actorType ?? ("user" as const),
    correlationId: attribution.correlationId,
    actorUserId: actor.userId,
    organizationId,
    action,
    targetType,
    targetId,
    outcome: "succeeded" as const,
    metadata: { ...metadata, ...attribution.metadata },
  };
}

export async function listOrganizationEvents(db: Database, actor: Actor, organizationId: string) {
  assertUuid(organizationId, "Organization");
  await requireOrganizationPermission(db, actor, organizationId, "event.read");
  return db
    .select({
      id: events.id,
      slug: events.slug,
      title: events.title,
      status: events.status,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      capacity: sql<number>`coalesce(sum(${inventoryItems.capacity}) FILTER (WHERE ${inventoryItems.kind} = 'admission'), 0)::int`,
      sold: sql<number>`coalesce(sum(${inventoryItems.sold}) FILTER (WHERE ${inventoryItems.kind} = 'admission'), 0)::int`,
    })
    .from(events)
    .leftJoin(inventoryItems, eq(inventoryItems.eventId, events.id))
    .where(eq(events.organizationId, organizationId))
    .groupBy(events.id)
    .orderBy(desc(events.startsAt));
}

export async function createEvent(db: Database, actor: Actor, organizationId: string, input: unknown) {
  assertUuid(organizationId, "Organization");
  const data = createEventSchema.parse(input);
  try {
    return await db.transaction(async (tx) => {
      await requireOrganizationPermission(tx, actor, organizationId, "event.write");
      const [event] = await tx
        .insert(events)
        .values({ ...data, organizationId, status: "draft" })
        .returning();
      await recordAudit(tx, audit(actor, organizationId, "event.create", "event", event!.id));
      return event!;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", "An event with this slug already exists.");
    throw error;
  }
}

export async function updateEvent(db: Database, actor: Actor, eventId: string, input: unknown) {
  assertUuid(eventId, "Event");
  const patch = updateEventSchema.parse(input);
  return db.transaction(async (tx) => {
    const [event] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
    if (!event) throw new AppError("NOT_FOUND", "Event not found.");
    await requireOrganizationPermission(tx, actor, event.organizationId, "event.write");
    if (patch.status) assertEventTransition(event.status, patch.status);

    const [updated] = await tx.update(events).set(patch).where(eq(events.id, eventId)).returning();
    await recordAudit(tx, audit(actor, event.organizationId, "event.update", "event", eventId, { patch }));
    return updated!;
  });
}

export async function createExperience(
  db: DbExecutor,
  actor: Actor,
  eventId: string,
  input: unknown,
  options: { origin?: "manual" | "ai_recommendation"; organizationId?: string; audit?: AuditAttribution } = {},
) {
  assertUuid(eventId, "Event");
  const data = createExperienceSchema.parse(input);
  try {
    return await db.transaction(async (tx) => {
      const [event] = await tx.select().from(events).where(eq(events.id, eventId)).for("share");
      if (!event || (options.organizationId && event.organizationId !== options.organizationId)) {
        throw new AppError("NOT_FOUND", "Event not found.");
      }
      await requireOrganizationPermission(tx, actor, event.organizationId, "experience.write");
      if (data.startsAt < event.startsAt || data.endsAt > event.endsAt) {
        throw new AppError("VALIDATION_FAILED", "The experience must take place during the event.");
      }

      const [experience] = await tx
        .insert(experiences)
        .values({
          organizationId: event.organizationId,
          eventId,
          slug: data.slug,
          title: data.title,
          description: data.description,
          category: data.category,
          location: data.location,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          status: "draft",
          origin: options.origin ?? "manual",
          createdByUserId: actor.userId,
        })
        .returning();
      const inventoryItem = await createInventoryItem(tx, {
        organizationId: event.organizationId,
        eventId,
        experienceId: experience!.id,
        name: data.title,
        priceMinor: data.priceMinor,
        currency: data.currency,
        capacity: data.capacity,
        maxPerOrder: data.maxPerOrder,
        status: "draft",
      });
      await recordAudit(
        tx,
        audit(actor, event.organizationId, "experience.create_draft", "experience", experience!.id, {
          capacity: data.capacity,
          priceMinor: data.priceMinor,
          origin: options.origin ?? "manual",
        }, options.audit),
      );
      return { experience: experience!, inventoryItem };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", "An experience with this slug already exists for the event.");
    throw error;
  }
}

/** Publishes the experience and puts its draft inventory on sale, atomically. */
export async function publishExperience(
  db: DbExecutor,
  actor: Actor,
  experienceId: string,
  options: { organizationId?: string; audit?: AuditAttribution } = {},
) {
  assertUuid(experienceId, "Experience");
  return db.transaction(async (tx) => {
    const [experience] = await tx.select().from(experiences).where(eq(experiences.id, experienceId)).for("update");
    if (!experience || (options.organizationId && experience.organizationId !== options.organizationId)) {
      throw new AppError("NOT_FOUND", "Experience not found.");
    }
    await requireOrganizationPermission(tx, actor, experience.organizationId, "experience.publish");
    assertExperienceTransition(experience.status, "published");

    const [event] = await tx.select({ status: events.status }).from(events).where(eq(events.id, experience.eventId));
    if (!event || !canHostPublishedExperience(event.status)) {
      throw new AppError("PRECONDITION_FAILED", "The event is no longer accepting new experiences.");
    }

    const [published] = await tx
      .update(experiences)
      .set({ status: "published", publishedAt: sql`now()` })
      .where(eq(experiences.id, experienceId))
      .returning();
    await tx
      .update(inventoryItems)
      .set({ status: "on_sale" })
      .where(and(eq(inventoryItems.experienceId, experienceId), eq(inventoryItems.status, "draft")));
    await recordAudit(tx, audit(actor, experience.organizationId, "experience.publish", "experience", experienceId, {}, options.audit));
    return published!;
  });
}

/** An experience with its sellable item, for an organization's members. `organizationId` pins the tenant. */
export async function getExperienceForOrganization(
  db: DbExecutor,
  actor: Actor,
  experienceId: string,
  options: { organizationId: string; permission?: "event.read" | "experience.write" | "experience.publish" },
) {
  assertUuid(experienceId, "Experience");
  const [row] = await db
    .select({ experience: experiences, item: inventoryItems, timeZone: events.timeZone })
    .from(experiences)
    .innerJoin(events, eq(events.id, experiences.eventId))
    .leftJoin(inventoryItems, eq(inventoryItems.experienceId, experiences.id))
    .where(eq(experiences.id, experienceId))
    .limit(1);
  if (!row || row.experience.organizationId !== options.organizationId) throw new AppError("NOT_FOUND", "Experience not found.");
  await requireOrganizationPermission(db, actor, row.experience.organizationId, options.permission ?? "event.read");
  return row;
}
