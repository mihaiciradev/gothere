import { randomUUID } from "node:crypto";
import { createDatabase } from "@/infrastructure/db/client";
import { events, inventoryItems, organizationMemberships, organizations, users } from "@/infrastructure/db/schema";

export function openTestDatabase(max = 5) {
  return createDatabase(process.env.DATABASE_URL!, max);
}

type Db = ReturnType<typeof openTestDatabase>["db"];

const unique = () => randomUUID().slice(0, 8);

export async function createUser(db: Db, overrides: Partial<typeof users.$inferInsert> = {}) {
  const suffix = unique();
  const [row] = await db
    .insert(users)
    .values({ name: `User ${suffix}`, email: `user-${suffix}@example.test`, ...overrides })
    .returning();
  return row!;
}

export async function createOrganization(db: Db) {
  const suffix = unique();
  const [row] = await db.insert(organizations).values({ slug: `org-${suffix}`, name: `Org ${suffix}` }).returning();
  return row!;
}

export async function addMember(db: Db, organizationId: string, userId: string, role: "owner" | "manager" | "analyst") {
  await db.insert(organizationMemberships).values({ organizationId, userId, role });
}

export async function createEvent(db: Db, organizationId: string) {
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
      startsAt: new Date("2027-07-01T12:00:00Z"),
      endsAt: new Date("2027-07-02T12:00:00Z"),
      status: "published",
    })
    .returning();
  return row!;
}

export async function createAdmission(db: Db, event: { id: string; organizationId: string }, capacity: number) {
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
      status: "on_sale",
    })
    .returning();
  return row!;
}
