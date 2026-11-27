import { expect, test } from "@playwright/test";

/**
 * API-level journey against the production build and the seeded database (UI arrives in M2):
 * sign in as a seeded attendee → browse → reserve → pay (simulated) → see tickets.
 */
test("a seeded attendee buys a ticket end to end", async ({ request, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "API journey runs once");
  const password = process.env.SEED_DEMO_PASSWORD;
  test.skip(!password, "SEED_DEMO_PASSWORD not set");
  const headers = { origin: baseURL! };

  const signIn = await request.post("/api/auth/sign-in/email", {
    headers,
    data: { email: "luca@attendee.gothere.test", password },
  });
  expect(signIn.ok()).toBe(true);

  const event = (await (await request.get("/api/events/halcyon-shore-2027")).json()).data;
  const sunset = event.experiences.flatMap((e: { items: { name: string; soldOut: boolean }[] }) => e.items).find((i: { name: string }) => i.name.startsWith("Sunset Sessions"));
  expect(sunset.soldOut).toBe(true);
  const admission = event.admissions.find((a: { name: string }) => a.name === "Saturday Day Pass");

  const reservation = await request.post("/api/reservations", {
    headers: { ...headers, "idempotency-key": `e2e-${crypto.randomUUID()}` },
    data: { eventId: event.id, items: [{ inventoryItemId: admission.id, quantity: 1 }] },
  });
  expect(reservation.status()).toBe(201);
  const { data: held } = await reservation.json();

  const payment = await request.post(`/api/reservations/${held.id}/payments`, {
    headers: { ...headers, "idempotency-key": `e2e-pay-${crypto.randomUUID()}` },
    data: {},
  });
  expect(payment.status()).toBe(201);
  expect((await payment.json()).data).toMatchObject({ disposition: "accepted", simulated: true });

  const tickets = (await (await request.get("/api/me/tickets")).json()).data;
  expect(tickets.some((t: { orderId: string; itemName: string }) => t.itemName === "Saturday Day Pass")).toBe(true);
});
