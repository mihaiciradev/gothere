import { and, desc, eq } from "drizzle-orm";
import type { DbExecutor } from "@/infrastructure/db/client";
import { events, experiences, inventoryItems, orders, tickets, users } from "@/infrastructure/db/schema";
import type { Actor } from "@/modules/identity";
import { AppError } from "@/shared/errors";
import { assertUuid } from "@/shared/ids";

const ticketFields = {
  id: tickets.id,
  code: tickets.code,
  status: tickets.status,
  issuedAt: tickets.issuedAt,
  orderId: tickets.orderId,
  itemName: inventoryItems.name,
  kind: inventoryItems.kind,
  holderName: users.name,
  event: {
    id: events.id,
    heroImageUrl: events.heroImageUrl,
    heroImageCredit: events.heroImageCredit,
    slug: events.slug,
    title: events.title,
    venueName: events.venueName,
    city: events.city,
    timeZone: events.timeZone,
    startsAt: events.startsAt,
    endsAt: events.endsAt,
  },
  experienceTitle: experiences.title,
  experienceStartsAt: experiences.startsAt,
  experienceEndsAt: experiences.endsAt,
  experienceLocation: experiences.location,
};

function ticketQuery(db: DbExecutor) {
  return db
    .select(ticketFields)
    .from(tickets)
    .innerJoin(inventoryItems, eq(inventoryItems.id, tickets.inventoryItemId))
    .innerJoin(events, eq(events.id, tickets.eventId))
    .innerJoin(users, eq(users.id, tickets.userId))
    .leftJoin(experiences, eq(experiences.id, inventoryItems.experienceId));
}

export function listTicketsForUser(db: DbExecutor, actor: Actor) {
  return ticketQuery(db).where(eq(tickets.userId, actor.userId)).orderBy(events.startsAt, tickets.issuedAt);
}

export async function getTicketForUser(db: DbExecutor, actor: Actor, ticketId: string) {
  assertUuid(ticketId, "Ticket");
  const [ticket] = await ticketQuery(db).where(and(eq(tickets.id, ticketId), eq(tickets.userId, actor.userId)));
  if (!ticket) throw new AppError("NOT_FOUND", "Ticket not found.");
  return ticket;
}

export function listOrdersForUser(db: DbExecutor, actor: Actor) {
  return db
    .select({
      id: orders.id,
      reservationId: orders.reservationId,
      status: orders.status,
      totalMinor: orders.totalMinor,
      currency: orders.currency,
      confirmedAt: orders.confirmedAt,
      event: { id: events.id, slug: events.slug, title: events.title },
    })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .where(eq(orders.userId, actor.userId))
    .orderBy(desc(orders.confirmedAt));
}

export async function findOrderForReservation(db: DbExecutor, reservationId: string) {
  const [order] = await db
    .select({ id: orders.id, status: orders.status, confirmedAt: orders.confirmedAt })
    .from(orders)
    .where(eq(orders.reservationId, reservationId));
  return order;
}
