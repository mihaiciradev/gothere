import { and, eq } from "drizzle-orm";
import { createAuth } from "../src/infrastructure/auth/auth";
import { createDatabase } from "../src/infrastructure/db/client";
import {
  events,
  experiences,
  inventoryItems,
  organizationMemberships,
  organizations,
  users,
} from "../src/infrastructure/db/schema";
import { assertNonProduction, loadLocalEnv } from "./lib/env";
import { seedEvents, seedOrganizations, seedUsers } from "./seed-data";

loadLocalEnv();
assertNonProduction("Seeding");

function required(name: string, minLength = 1): string {
  const value = process.env[name];
  if (!value || value.length < minLength) throw new Error(`${name} is required (min ${minLength} chars).`);
  return value;
}

const databaseUrl = required("DATABASE_URL");
const passwords = { demo: required("SEED_DEMO_PASSWORD", 12), admin: required("SEED_ADMIN_PASSWORD", 16) };

const { db, pool } = createDatabase(databaseUrl, 2);
const auth = createAuth({
  db,
  secret: required("BETTER_AUTH_SECRET", 32),
  baseURL: required("BETTER_AUTH_URL"),
  production: false,
  rateLimitEnabled: false,
});

async function seedUser(user: (typeof seedUsers)[number]): Promise<string> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, user.email));
  const id =
    existing?.id ??
    (await auth.api.signUpEmail({ body: { name: user.name, email: user.email, password: passwords[user.password] } })).user.id;
  // Roles are assigned server-side only; sign-up never accepts them.
  await db.update(users).set({ platformRole: user.platformRole, emailVerified: true }).where(eq(users.id, id));
  return id;
}

async function main() {
  const userIds = new Map<string, string>();
  for (const user of seedUsers) userIds.set(user.key, await seedUser(user));

  const orgIds = new Map<string, string>();
  for (const org of seedOrganizations) {
    await db.insert(organizations).values({ slug: org.slug, name: org.name }).onConflictDoNothing();
    const [row] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, org.slug));
    orgIds.set(org.slug, row!.id);
    for (const member of org.members) {
      await db
        .insert(organizationMemberships)
        .values({ organizationId: row!.id, userId: userIds.get(member.user)!, role: member.role })
        .onConflictDoNothing();
    }
  }

  for (const event of seedEvents) {
    const organizationId = orgIds.get(event.organization)!;
    await db
      .insert(events)
      .values({
        organizationId,
        slug: event.slug,
        title: event.title,
        summary: event.summary,
        description: event.description,
        venueName: event.venueName,
        city: event.city,
        countryCode: event.countryCode,
        timeZone: event.timeZone,
        startsAt: new Date(event.startsAt),
        endsAt: new Date(event.endsAt),
        status: "published",
      })
      .onConflictDoNothing();
    const [eventRow] = await db.select({ id: events.id }).from(events).where(eq(events.slug, event.slug));
    const eventId = eventRow!.id;

    const ensureInventory = async (
      item: (typeof event.admissions)[number],
      experienceId: string | null,
    ) => {
      const [found] = await db
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.eventId, eventId), eq(inventoryItems.name, item.name)));
      if (found) return;
      await db.insert(inventoryItems).values({
        organizationId,
        eventId,
        experienceId,
        kind: experienceId ? "experience" : "admission",
        name: item.name,
        description: item.description,
        priceMinor: item.priceMinor,
        currency: "EUR",
        capacity: item.capacity,
        maxPerOrder: item.maxPerOrder ?? 6,
        status: "on_sale",
      });
    };

    for (const admission of event.admissions) await ensureInventory(admission, null);

    for (const experience of event.experiences) {
      await db
        .insert(experiences)
        .values({
          organizationId,
          eventId,
          slug: experience.slug,
          title: experience.title,
          description: experience.description,
          category: experience.category,
          location: experience.location,
          startsAt: new Date(experience.startsAt),
          endsAt: new Date(experience.endsAt),
          status: "published",
          publishedAt: new Date(),
        })
        .onConflictDoNothing();
      const [experienceRow] = await db
        .select({ id: experiences.id })
        .from(experiences)
        .where(and(eq(experiences.eventId, eventId), eq(experiences.slug, experience.slug)));
      await ensureInventory(experience.inventory, experienceRow!.id);
    }
  }

  console.log(
    JSON.stringify({
      level: "info",
      msg: "seed complete",
      users: userIds.size,
      organizations: orgIds.size,
      events: seedEvents.length,
    }),
  );
}

try {
  await main();
} finally {
  await pool.end();
}
