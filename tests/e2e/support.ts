import { type APIRequestContext, type Page, expect } from "@playwright/test";
import { Pool } from "pg";

/** Test-only database access for time travel (expiring holds, making jobs due). Never used by the app. */
let pool: Pool | undefined;
export function db(): Pool {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  return pool;
}

export const password = () => `e2e-${crypto.randomUUID()}`;

/** Creates and signs in a fresh attendee in the page's browser context (cookies are shared). */
export async function signUp(page: Page, baseURL: string, name = "E2E Attendee") {
  const email = `e2e-${crypto.randomUUID()}@example.test`;
  const response = await page.request.post("/api/auth/sign-up/email", {
    headers: { origin: baseURL },
    data: { name, email, password: password() },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return email;
}

export async function itemId(request: APIRequestContext, slug: string, name: string): Promise<string> {
  const { data } = await (await request.get(`/api/events/${slug}`)).json();
  const items = [...data.admissions, ...data.experiences.flatMap((e: { items: unknown[] }) => e.items)] as { id: string; name: string }[];
  const item = items.find((i) => i.name === name);
  if (!item) throw new Error(`no item ${name} on ${slug}`);
  return item.id;
}

export async function reserveViaApi(page: Page, baseURL: string, slug: string, name: string, quantity = 1): Promise<string> {
  const { data: event } = await (await page.request.get(`/api/events/${slug}`)).json();
  const response = await page.request.post("/api/reservations", {
    headers: { origin: baseURL, "idempotency-key": crypto.randomUUID() },
    data: { eventId: event.id, items: [{ inventoryItemId: await itemId(page.request, slug, name), quantity }] },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).data.id;
}

export async function payViaApi(page: Page, baseURL: string, reservationId: string, scenario = "success") {
  const response = await page.request.post(`/api/reservations/${reservationId}/payments`, {
    headers: { origin: baseURL, "idempotency-key": crypto.randomUUID() },
    data: { scenario },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).data;
}

export async function expireReservation(id: string) {
  await db().query("UPDATE reservations SET expires_at = now() - interval '1 second' WHERE id = $1", [id]);
}

export async function makeJobsDue() {
  await db().query("UPDATE jobs SET run_at = now() WHERE status = 'queued'");
}

/** Opens the (collapsed) simulator demo control on checkout and picks an outcome. */
export async function chooseScenario(page: Page, label: string) {
  const option = page.getByText(label, { exact: true });
  if (!(await option.isVisible())) await page.getByText(/Simulator outcome · demo control/).click();
  await option.click();
}
