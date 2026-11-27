import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { events, experiences, inventoryItems } from "@/infrastructure/db/schema";
import { getCatalogFacets, getPublishedEvent, listPublishedEvents, listUpcomingExperiences } from "@/modules/events";
import { createReservation } from "@/modules/reservations";
import { createActor, createExperienceItem, createSellableEvent, forceOverdue, key, openTestDatabase } from "./support/fixtures";

const { db, pool } = openTestDatabase();
afterAll(() => pool.end());

async function catalogueFixture(city: string, category: "festival" | "club") {
  const fixture = await createSellableEvent(db, 100);
  const title = `Catalogue ${crypto.randomUUID().slice(0, 6)}`;
  await db.update(events).set({ city, category, title }).where(eq(events.id, fixture.event.id));
  return { ...fixture, title };
}

describe("public catalogue", () => {
  it("filters by keyword, category, city and month, and rejects unknown filters", async () => {
    const city = `Testopolis-${crypto.randomUUID().slice(0, 6)}`;
    const a = await catalogueFixture(city, "club");
    await catalogueFixture(city, "festival");

    expect((await listPublishedEvents(db, { city })).length).toBe(2);
    expect((await listPublishedEvents(db, { city, category: "club" })).map((e) => e.id)).toEqual([a.event.id]);
    expect((await listPublishedEvents(db, { q: a.title.slice(-6) })).map((e) => e.id)).toEqual([a.event.id]);
    expect(await listPublishedEvents(db, { city, month: "2030-07" })).toHaveLength(2);
    expect(await listPublishedEvents(db, { city, month: "2030-08" })).toHaveLength(0);
    // LIKE wildcards in user input are literal, not patterns.
    expect(await listPublishedEvents(db, { q: "%" })).toHaveLength(0);
    await expect(listPublishedEvents(db, { category: "rave" } as never)).rejects.toMatchObject({ name: "ZodError" });
    await expect(listPublishedEvents(db, { sort: "price" } as never)).rejects.toMatchObject({ name: "ZodError" });
  });

  it("finds events through their experiences", async () => {
    const { event } = await createSellableEvent(db, 10);
    const { experience } = await createExperienceItem(db, event, 10);
    const word = `Zephyr${crypto.randomUUID().slice(0, 5)}`;
    await db.update(experiences).set({ title: `${word} session` }).where(eq(experiences.id, experience.id));
    expect((await listPublishedEvents(db, { q: word })).map((e) => e.id)).toEqual([event.id]);
  });

  it("reports price and availability status, treating overdue holds as available", async () => {
    const { event, admission } = await createSellableEvent(db, 10);
    const buyer = await createActor(db);
    const held = await createReservation(db, buyer, { eventId: event.id, items: [{ inventoryItemId: admission.id, quantity: 10 }] }, { idempotencyKey: key() });

    let card = (await listPublishedEvents(db, { q: event.title })).find((e) => e.id === event.id)!;
    expect(card).toMatchObject({ availability: "sold_out", fromPriceMinor: admission.priceMinor });

    await forceOverdue(db, held.id);
    card = (await listPublishedEvents(db, { q: event.title })).find((e) => e.id === event.id)!;
    expect(card.availability).toBe("available");
    expect((await getPublishedEvent(db, event.slug)).admissions[0]!.available).toBe(10);
  });

  it("marks low stock as limited and sold-out experiences as sold out", async () => {
    const { event, admission } = await createSellableEvent(db, 100);
    await db.update(inventoryItems).set({ sold: 95 }).where(eq(inventoryItems.id, admission.id));
    const { item } = await createExperienceItem(db, event, 5);
    await db.update(inventoryItems).set({ sold: 5 }).where(eq(inventoryItems.id, item.id));

    const detail = await getPublishedEvent(db, event.slug);
    expect(detail.availability).toBe("limited");
    expect(detail.experiences[0]!.items[0]).toMatchObject({ soldOut: true, available: 0 });
    const feed = await listUpcomingExperiences(db, 500);
    expect(feed.find((e) => e.event.slug === event.slug)).toMatchObject({ soldOut: true });
  });

  it("hides drafts and past events from every public read", async () => {
    const { event } = await createSellableEvent(db, 10);
    await db.update(events).set({ status: "draft" }).where(eq(events.id, event.id));
    expect((await listPublishedEvents(db, { q: event.title })).length).toBe(0);
    await expect(getPublishedEvent(db, event.slug)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const past = await createSellableEvent(db, 10);
    await db
      .update(events)
      .set({ startsAt: sql`now() - interval '3 days'`, endsAt: sql`now() - interval '2 days'` })
      .where(eq(events.id, past.event.id));
    expect((await listPublishedEvents(db, { q: past.event.title })).length).toBe(0);
  });

  it("exposes facets only for upcoming published events", async () => {
    const facets = await getCatalogFacets(db);
    expect(facets.months.every((m) => /^\d{4}-\d{2}$/.test(m.value))).toBe(true);
    expect(facets.categories.every((c) => c.count > 0)).toBe(true);
  });
});
