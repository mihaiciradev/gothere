import { afterAll, describe, expect, it } from "vitest";
import * as eventDetail from "@/app/api/events/[slug]/route";
import * as eventsList from "@/app/api/events/route";
import * as ticketDetail from "@/app/api/me/tickets/[id]/route";
import * as myTickets from "@/app/api/me/tickets/route";
import * as operationsRun from "@/app/api/operations/run/route";
import * as inventoryRoute from "@/app/api/organizer/inventory/[inventoryItemId]/route";
import * as webhook from "@/app/api/payments/simulator/webhook/route";
import * as reservationDetail from "@/app/api/reservations/[id]/route";
import * as payments from "@/app/api/reservations/[id]/payments/route";
import * as reservationsRoute from "@/app/api/reservations/route";
import { getAuth } from "@/infrastructure/auth";
import { closeDb, getDb } from "@/infrastructure/db/client";
import { users } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { addMember, createSellableEvent, key } from "./support/fixtures";

const origin = process.env.BETTER_AUTH_URL!;
afterAll(() => closeDb());

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(
  handler: Handler,
  init: { method?: string; path?: string; body?: unknown; cookie?: string; headers?: Record<string, string>; params?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json", ...init.headers };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.method && init.method !== "GET" && !("origin" in headers)) headers.origin = origin;
  const response = await handler(
    new Request(`${origin}${init.path ?? "/api/test"}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
    { params: Promise.resolve(init.params ?? {}) },
  );
  const json = (await response.json()) as { data?: any; error?: { code: string; details?: any }; correlationId?: string };
  return { status: response.status, headers: response.headers, ...json };
}

async function signedInUser() {
  const email = `http-${crypto.randomUUID()}@example.test`;
  const response = await getAuth().handler(
    new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ name: "HTTP Tester", email, password: "http-test-password-1" }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  const [user] = await getDb().select().from(users).where(eq(users.email, email));
  return { cookie, user: user! };
}

describe("public catalogue", () => {
  it("lists published events and echoes a valid correlation id", async () => {
    const { event } = await createSellableEvent(getDb(), 10);
    const res = await call(eventsList.GET as Handler, { headers: { "x-request-id": "req-abcdef123" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("req-abcdef123");
    expect(res.data.map((e: { id: string }) => e.id)).toContain(event.id);
  });

  it("returns live availability for an event", async () => {
    const { event, admission } = await createSellableEvent(getDb(), 7);
    const res = await call(eventDetail.GET as Handler, { params: { slug: event.slug } });
    expect(res.data.admissions[0]).toMatchObject({ id: admission.id, available: 7, soldOut: false });
  });
});

describe("attendee purchase journey over HTTP", () => {
  it("requires a session", async () => {
    const res = await call(reservationsRoute.POST as Handler, { method: "POST", body: {} });
    expect(res.status).toBe(401);
    expect(res.error?.code).toBe("UNAUTHENTICATED");
  });

  it("rejects cross-site cookie-authenticated mutations", async () => {
    const { cookie } = await signedInUser();
    const res = await call(reservationsRoute.POST as Handler, {
      method: "POST",
      cookie,
      headers: { origin: "https://evil.example", "idempotency-key": key() },
      body: {},
    });
    expect(res.status).toBe(403);
    expect(res.error?.details?.reason).toBe("csrf");
  });

  it("rejects client-supplied prices and a missing Idempotency-Key", async () => {
    const { cookie } = await signedInUser();
    const { event, admission } = await createSellableEvent(getDb(), 10);
    const withPrice = await call(reservationsRoute.POST as Handler, {
      method: "POST",
      cookie,
      headers: { "idempotency-key": key() },
      body: { eventId: event.id, items: [{ inventoryItemId: admission.id, quantity: 1, unitPriceMinor: 1 }] },
    });
    expect(withPrice.status).toBe(422);

    const noKey = await call(reservationsRoute.POST as Handler, {
      method: "POST",
      cookie,
      body: { eventId: event.id, items: [{ inventoryItemId: admission.id, quantity: 1 }] },
    });
    expect(noKey.status).toBe(422);
  });

  it("reserves, pays, confirms and issues tickets visible only to the owner", async () => {
    const owner = await signedInUser();
    const intruder = await signedInUser();
    const { event, admission } = await createSellableEvent(getDb(), 10);

    const reserved = await call(reservationsRoute.POST as Handler, {
      method: "POST",
      cookie: owner.cookie,
      headers: { "idempotency-key": key() },
      body: { eventId: event.id, items: [{ inventoryItemId: admission.id, quantity: 2 }] },
    });
    expect(reserved.status).toBe(201);
    expect(reserved.data).toMatchObject({ status: "active", totalMinor: 2 * admission.priceMinor });
    const reservationId = reserved.data.id as string;

    const paid = await call(payments.POST as Handler, {
      method: "POST",
      cookie: owner.cookie,
      headers: { "idempotency-key": key() },
      params: { id: reservationId },
      body: { scenario: "success" },
    });
    expect(paid.status).toBe(201);
    expect(paid.data).toMatchObject({ status: "succeeded", disposition: "accepted", amountMinor: 2 * admission.priceMinor, simulated: true });

    const detail = await call(reservationDetail.GET as Handler, { cookie: owner.cookie, params: { id: reservationId } });
    expect(detail.data).toMatchObject({ status: "converted" });
    expect(detail.data.orderId).toBeTruthy();

    const tickets = await call(myTickets.GET as Handler, { cookie: owner.cookie });
    const mine = tickets.data.filter((t: { event: { id: string } }) => t.event.id === event.id);
    expect(mine).toHaveLength(2);
    expect(mine[0].code).toMatch(/^GT-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    const foreignReservation = await call(reservationDetail.GET as Handler, { cookie: intruder.cookie, params: { id: reservationId } });
    const foreignTicket = await call(ticketDetail.GET as Handler, { cookie: intruder.cookie, params: { id: mine[0].id } });
    expect([foreignReservation.status, foreignTicket.status]).toEqual([404, 404]);
  });

  it("rate-limits reservation attempts per user", async () => {
    const { cookie } = await signedInUser();
    const { event, admission } = await createSellableEvent(getDb(), 100);
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await call(reservationsRoute.POST as Handler, {
        method: "POST",
        cookie,
        headers: { "idempotency-key": key() },
        body: { eventId: event.id, items: [{ inventoryItemId: admission.id, quantity: 1 }] },
      });
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(3); // active reservation cap
    expect(statuses.at(-1)).toBe(429);
  });
});

describe("organizer API", () => {
  it("rejects inventory changes by a read-only member", async () => {
    const { cookie, user } = await signedInUser();
    const { organization, admission } = await createSellableEvent(getDb(), 10);
    await addMember(getDb(), organization.id, user.id, "analyst");
    const res = await call(inventoryRoute.PATCH as Handler, {
      method: "PATCH",
      cookie,
      params: { inventoryItemId: admission.id },
      body: { priceMinor: 1 },
    });
    expect(res.status).toBe(403);
  });
});

describe("machine endpoints", () => {
  it("rejects unsigned provider notifications", async () => {
    const res = await call(webhook.POST as Handler, {
      method: "POST",
      body: { id: "evt_unsigned_000", type: "payment.updated", createdAt: new Date().toISOString(), data: {} },
    });
    expect(res.status).toBe(401);
  });

  it("protects the operations runner with the cron secret", async () => {
    const run = operationsRun.POST as Handler;
    expect((await call(run, { method: "POST" })).status).toBe(401);
    expect((await call(run, { method: "POST", headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    const ok = await call(run, { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    expect(ok.status).toBe(200);
    expect(ok.data).toHaveProperty("expiredReservations");
  });
});
