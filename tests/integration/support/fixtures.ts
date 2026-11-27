import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect } from "vitest";
import { type Database, createDatabase } from "@/infrastructure/db/client";
import {
  events,
  experiences,
  inventoryItems,
  organizationMemberships,
  organizations,
  reservations,
  users,
} from "@/infrastructure/db/schema";
import type { Actor } from "@/modules/identity";
import { type PaymentDeps, createSimulatorProvider } from "@/modules/payments";
import { AppError } from "@/shared/errors";

export function openTestDatabase(max = 5) {
  return createDatabase(process.env.DATABASE_URL!, max);
}

const unique = () => randomUUID().slice(0, 8);

export async function createUser(db: Database, overrides: Partial<typeof users.$inferInsert> = {}) {
  const suffix = unique();
  const [row] = await db
    .insert(users)
    .values({ name: `User ${suffix}`, email: `user-${suffix}@example.test`, ...overrides })
    .returning();
  return row!;
}

export function actorFor(user: { id: string; email: string; platformRole?: "attendee" | "platform_admin" }): Actor {
  return { kind: "user", userId: user.id, email: user.email, platformRole: user.platformRole ?? "attendee" };
}

export async function createActor(db: Database): Promise<Actor> {
  return actorFor(await createUser(db));
}

export async function createOrganization(db: Database) {
  const suffix = unique();
  const [row] = await db.insert(organizations).values({ slug: `org-${suffix}`, name: `Org ${suffix}` }).returning();
  return row!;
}

export async function addMember(db: Database, organizationId: string, userId: string, role: "owner" | "manager" | "analyst") {
  await db.insert(organizationMemberships).values({ organizationId, userId, role });
}

export async function createEvent(db: Database, organizationId: string, status: "draft" | "published" = "published") {
  const suffix = unique();
  const [row] = await db
    .insert(events)
    .values({
      organizationId,
      slug: `event-${suffix}`,
      title: `Event ${suffix}`,
      summary: "Test event",
      description: "Test event",
      venueName: "Test Venue",
      city: "Testville",
      countryCode: "RO",
      timeZone: "Europe/Bucharest",
      startsAt: new Date("2030-07-01T12:00:00Z"),
      endsAt: new Date("2030-07-03T12:00:00Z"),
      status,
    })
    .returning();
  return row!;
}

export async function createAdmission(
  db: Database,
  event: { id: string; organizationId: string },
  capacity: number,
  overrides: Partial<typeof inventoryItems.$inferInsert> = {},
) {
  const [row] = await db
    .insert(inventoryItems)
    .values({
      organizationId: event.organizationId,
      eventId: event.id,
      kind: "admission",
      name: `Admission ${unique()}`,
      priceMinor: 5000,
      currency: "EUR",
      capacity,
      maxPerOrder: 10,
      status: "on_sale",
      ...overrides,
    })
    .returning();
  return row!;
}

export async function createExperienceItem(db: Database, event: { id: string; organizationId: string }, capacity: number) {
  const [experience] = await db
    .insert(experiences)
    .values({
      organizationId: event.organizationId,
      eventId: event.id,
      slug: `exp-${unique()}`,
      title: "Experience",
      description: "Experience",
      category: "music",
      startsAt: new Date("2030-07-01T18:00:00Z"),
      endsAt: new Date("2030-07-01T19:00:00Z"),
      status: "published",
      publishedAt: new Date(),
    })
    .returning();
  const [item] = await db
    .insert(inventoryItems)
    .values({
      organizationId: event.organizationId,
      eventId: event.id,
      experienceId: experience!.id,
      kind: "experience",
      name: `Session ${unique()}`,
      priceMinor: 3500,
      currency: "EUR",
      capacity,
      maxPerOrder: 2,
      status: "on_sale",
    })
    .returning();
  return { experience: experience!, item: item! };
}

/** A published event of a fresh organization with one admission item. */
export async function createSellableEvent(db: Database, capacity = 100) {
  const organization = await createOrganization(db);
  const event = await createEvent(db, organization.id);
  const admission = await createAdmission(db, event, capacity);
  return { organization, event, admission };
}

export async function inventory(db: Database, id: string) {
  const [row] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id));
  return row!;
}

/** Test-only time travel: moves a reservation's expiry into the past. */
export async function forceOverdue(db: Database, reservationId: string) {
  await db
    .update(reservations)
    .set({ expiresAt: sql`now() - interval '1 second'` })
    .where(eq(reservations.id, reservationId));
}

export function simulatorDeps(db: Database, options: { delayedSuccessSeconds?: number } = {}): PaymentDeps {
  return { provider: createSimulatorProvider(db, options), allowScenarios: true };
}

export const key = () => `test-${randomUUID()}`;

export async function expectAppError(promise: Promise<unknown>, code: AppError["code"], reason?: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, `expected AppError ${code}`).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  if (reason) expect((error as AppError).details?.reason).toBe(reason);
  return error as AppError;
}
