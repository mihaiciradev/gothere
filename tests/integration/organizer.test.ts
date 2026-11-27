import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { auditRecords, inventoryItems } from "@/infrastructure/db/schema";
import {
  createEvent as createEventService,
  createExperience,
  getPublishedEvent,
  listOrganizationEvents,
  publishExperience,
  updateEvent,
} from "@/modules/events";
import { updateInventoryItem } from "@/modules/inventory";
import { createReservation } from "@/modules/reservations";
import {
  actorFor,
  addMember,
  createActor,
  createSellableEvent,
  createUser,
  expectAppError,
  key,
  openTestDatabase,
} from "./support/fixtures";

const { db, pool } = openTestDatabase();
afterAll(() => pool.end());

async function tenant() {
  const { organization, event, admission } = await createSellableEvent(db, 50);
  const member = async (role: "owner" | "manager" | "analyst") => {
    const user = await createUser(db);
    await addMember(db, organization.id, user.id, role);
    return actorFor(user);
  };
  return { organization, event, admission, owner: await member("owner"), manager: await member("manager"), analyst: await member("analyst") };
}

const experienceInput = (slug = `sunset-${crypto.randomUUID().slice(0, 6)}`) => ({
  slug,
  title: "Sunset Sessions · Second Show",
  description: "A second sunset set.",
  category: "music",
  startsAt: "2030-07-01T19:00:00Z",
  endsAt: "2030-07-01T20:30:00Z",
  capacity: 150,
  priceMinor: 3500,
  maxPerOrder: 2,
});

describe("organizer management", () => {
  it("creates a draft experience, publishes it and makes it purchasable", async () => {
    const { event, manager } = await tenant();
    const { experience, inventoryItem } = await createExperience(db, manager, event.id, experienceInput());
    expect(experience.status).toBe("draft");
    expect(inventoryItem.status).toBe("draft");

    const before = await getPublishedEvent(db, event.slug);
    expect(before.experiences.find((e) => e.id === experience.id)).toBeUndefined();

    await publishExperience(db, manager, experience.id);
    const after = await getPublishedEvent(db, event.slug);
    const listed = after.experiences.find((e) => e.id === experience.id);
    expect(listed?.items[0]).toMatchObject({ available: 150, priceMinor: 3500, onSale: true });

    const buyer = await createActor(db);
    const reservation = await createReservation(
      db,
      buyer,
      { eventId: event.id, items: [{ inventoryItemId: inventoryItem.id, quantity: 2 }] },
      { idempotencyKey: key() },
    );
    expect(reservation.totalMinor).toBe(7000);

    const audit = await db.select().from(auditRecords).where(eq(auditRecords.targetId, experience.id));
    expect(audit.map((a) => a.action).sort()).toEqual(["experience.create_draft", "experience.publish"]);
  });

  it("rejects mutations by members without the permission", async () => {
    const { organization, event, admission, analyst } = await tenant();
    await expectAppError(createExperience(db, analyst, event.id, experienceInput()), "FORBIDDEN");
    await expectAppError(updateEvent(db, analyst, event.id, { title: "Hijacked" }), "FORBIDDEN");
    await expectAppError(updateInventoryItem(db, analyst, admission.id, { priceMinor: 1 }), "FORBIDDEN");
    await expectAppError(
      createEventService(db, analyst, organization.id, {
        slug: `x-${crypto.randomUUID().slice(0, 6)}`,
        title: "x",
        summary: "x",
        description: "x",
        venueName: "x",
        city: "x",
        countryCode: "RO",
        timeZone: "Europe/Bucharest",
        startsAt: "2030-01-01T10:00:00Z",
        endsAt: "2030-01-01T12:00:00Z",
      }),
      "FORBIDDEN",
    );
  });

  it("rejects publishing by a role that may only draft", async () => {
    const { event, owner, analyst } = await tenant();
    const { experience } = await createExperience(db, owner, event.id, experienceInput());
    await expectAppError(publishExperience(db, analyst, experience.id), "FORBIDDEN");
  });

  it("rejects cross-tenant mutations and reads without revealing the tenant", async () => {
    const a = await tenant();
    const b = await tenant();
    await expectAppError(createExperience(db, b.owner, a.event.id, experienceInput()), "NOT_FOUND");
    await expectAppError(updateEvent(db, b.owner, a.event.id, { title: "Hijacked" }), "NOT_FOUND");
    await expectAppError(updateInventoryItem(db, b.owner, a.admission.id, { capacity: 1 }), "NOT_FOUND");
    await expectAppError(listOrganizationEvents(db, b.owner, a.organization.id), "NOT_FOUND");
  });

  it("enforces lifecycle transitions", async () => {
    const { event, owner } = await tenant();
    const { experience } = await createExperience(db, owner, event.id, experienceInput());
    await updateEvent(db, owner, event.id, { status: "cancelled" });
    await expectAppError(updateEvent(db, owner, event.id, { status: "published" }), "PRECONDITION_FAILED");
    await expectAppError(publishExperience(db, owner, experience.id), "PRECONDITION_FAILED");
  });

  it("cannot lower capacity below units already reserved or sold", async () => {
    const { event, admission, manager } = await tenant();
    const buyer = await createActor(db);
    await createReservation(db, buyer, { eventId: event.id, items: [{ inventoryItemId: admission.id, quantity: 5 }] }, { idempotencyKey: key() });

    await expectAppError(updateInventoryItem(db, manager, admission.id, { capacity: 4 }), "PRECONDITION_FAILED");
    await updateInventoryItem(db, manager, admission.id, { capacity: 5 });
    const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, admission.id));
    expect(item!.capacity).toBe(5);
  });

  it("validates experience timing against the event", async () => {
    const { event, owner } = await tenant();
    await expectAppError(
      createExperience(db, owner, event.id, { ...experienceInput(), startsAt: "2031-01-01T10:00:00Z", endsAt: "2031-01-01T11:00:00Z" }),
      "VALIDATION_FAILED",
    );
  });
});
