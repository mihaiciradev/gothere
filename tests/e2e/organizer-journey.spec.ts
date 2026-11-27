import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { type Page, type TestInfo, expect, test } from "@playwright/test";
import { db, signUp } from "./support";

/**
 * The flagship closed loop, through the real interface: unmet demand → analysis → agent draft → human approval →
 * on sale. Each run builds its own tenant (fresh organiser, organization, event and sold-out session with 30 distinct
 * interested people) so it never touches the demonstration data.
 */
async function organizerFixture(page: Page, baseURL: string) {
  const email = await signUp(page, baseURL, "Irina E2E");
  const suffix = crypto.randomUUID().slice(0, 8);
  const sql = db();
  const { rows: [user] } = await sql.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  const { rows: [org] } = await sql.query<{ id: string }>(
    "INSERT INTO organizations (slug, name) VALUES ($1, $2) RETURNING id",
    [`e2e-org-${suffix}`, `E2E Collective ${suffix}`],
  );
  await sql.query("INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [org!.id, user!.id]);
  const { rows: [event] } = await sql.query<{ id: string; slug: string }>(
    `INSERT INTO events (organization_id, slug, title, summary, description, venue_name, city, country_code, time_zone, starts_at, ends_at, status)
     VALUES ($1, $2, $3, 'Test festival', 'Test festival', 'Dunes', 'Constanța', 'RO', 'Europe/Bucharest',
             date_trunc('day', now()) + interval '30 days 8 hours', date_trunc('day', now()) + interval '32 days 20 hours', 'published')
     RETURNING id, slug`,
    [org!.id, `e2e-festival-${suffix}`, `E2E Festival ${suffix}`],
  );
  await sql.query(
    "INSERT INTO inventory_items (organization_id, event_id, kind, name, price_minor, currency, capacity, status) VALUES ($1, $2, 'admission', 'Weekend', 9000, 'EUR', 500, 'on_sale')",
    [org!.id, event!.id],
  );
  const { rows: [experience] } = await sql.query<{ id: string }>(
    `INSERT INTO experiences (organization_id, event_id, slug, title, description, category, location, starts_at, ends_at, status, published_at)
     VALUES ($1, $2, 'pier-sunset', 'Pier Sunset', 'Sunset set on the pier.', 'music', 'North Pier',
             date_trunc('day', now()) + interval '30 days 16 hours 30 minutes', date_trunc('day', now()) + interval '30 days 18 hours', 'published', now())
     RETURNING id`,
    [org!.id, event!.id],
  );
  const { rows: [item] } = await sql.query<{ id: string }>(
    `INSERT INTO inventory_items (organization_id, event_id, experience_id, kind, name, price_minor, currency, capacity, sold, max_per_order, status)
     VALUES ($1, $2, $3, 'experience', 'Pier Sunset · Friday', 3000, 'EUR', 10, 10, 2, 'on_sale') RETURNING id`,
    [org!.id, event!.id, experience!.id],
  );
  for (let i = 0; i < 30; i++) {
    await sql.query(
      "INSERT INTO demand_signals (kind, organization_id, event_id, inventory_item_id, subject_key, origin) VALUES ('sold_out_view', $1, $2, $3, $4, 'live')",
      [org!.id, event!.id, item!.id, `e2e-${suffix}-${i}`],
    );
  }
  return { id: event!.id, slug: event!.slug, title: `E2E Festival ${suffix}` };
}

async function audit(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`)).toEqual([]);
}

async function shot(page: Page, info: TestInfo, name: string) {
  if (!process.env.CAPTURE) return;
  mkdirSync("docs/reports/m3", { recursive: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `docs/reports/m3/${info.project.name}-${name}.jpg`, fullPage: true, type: "jpeg", quality: 78 });
}

const cleanup: string[] = [];
test.afterEach(async () => {
  for (const id of cleanup.splice(0)) await db().query("UPDATE events SET status = 'completed' WHERE id = $1", [id]);
});

test.describe("organizer intelligence", () => {
  test("unmet demand becomes an approved, purchasable second session", async ({ page, baseURL }, info) => {
    test.setTimeout(90_000);
    const fixture = await organizerFixture(page, baseURL!);
    // Keep the fixture out of the public catalogue once the test is done (published → completed is a legal transition).
    test.info().attach("event", { body: fixture.slug });
    cleanup.push(fixture.id);

    await page.goto("/organizer");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("link", { name: fixture.title })).toBeVisible();
    await audit(page);
    await shot(page, info, "organizer-overview");

    await page.goto("/organizer/intelligence");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Run demand analysis" }).click();
    const card = page.locator("article:visible", { hasText: "Pier Sunset · Second session" });
    await expect(card).toBeVisible();
    // 30 interested ≥ 2 × 10 places → EUR 30 + 15%, rounded to EUR 35; 10 × EUR 35 = EUR 350 at most.
    await expect(card.getByText("€350", { exact: true }).first()).toBeVisible();
    await expect(card.getByText("Estimate, not revenue")).toBeVisible();
    await audit(page);
    await shot(page, info, "organizer-intelligence");

    await card.getByRole("button", { name: "Let the agent prepare it" }).click();
    await expect(card.getByText(/Prepared by (rules automation|the AI agent)/)).toBeVisible();
    await expect(card.getByText("Draft awaiting approval")).toBeVisible();
    await card.getByRole("link", { name: "Review in approvals →" }).click();

    await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
    // Visited routes stay mounted (hidden) in Activity boundaries; scope to what is on screen.
    const request = page.locator("article:visible", { hasText: "Pier Sunset · Second session" });
    await expect(request.getByText("HIGH risk")).toBeVisible();
    await expect(request.getByText("€35", { exact: true })).toBeVisible();
    await audit(page);
    await shot(page, info, "organizer-approval");

    // Not on sale before the decision.
    let event = (await (await page.request.get(`/api/events/${fixture.slug}`)).json()).data;
    expect(event.experiences.map((x: { title: string }) => x.title)).not.toContain("Pier Sunset · Second session");

    await request.getByRole("button", { name: "Approve and publish" }).click();
    await expect(page.getByText("Approved and executed. The experience is on sale.")).toBeVisible();
    await shot(page, info, "organizer-approved");

    event = (await (await page.request.get(`/api/events/${fixture.slug}`)).json()).data;
    const second = event.experiences.find((x: { title: string }) => x.title === "Pier Sunset · Second session");
    expect(second.items[0]).toMatchObject({ priceMinor: 3500, onSale: true, available: 10 });

    await page.goto("/organizer/intelligence");
    await expect(page.getByText("Actual sales since publishing")).toBeVisible();
    await shot(page, info, "organizer-outcome");
  });

  test("attendees without organizer membership see an honest empty state", async ({ page, baseURL }) => {
    await signUp(page, baseURL!);
    await page.goto("/organizer");
    await expect(page.getByText("You’re not part of an organizer team yet.")).toBeVisible();
  });
});

test.describe("concierge", () => {
  test("answers with real listings and says when it is a plain search", async ({ page }, info) => {
    await page.goto("/discover");
    await page.waitForLoadState("networkidle");
    await page.getByLabel(/Describe what you’re looking for/).fill("sunset by the sea");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByText(/Plain search · no AI involved|AI picks from live listings/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Halcyon Shore/ }).first()).toBeVisible();
    await audit(page);
    await shot(page, info, "concierge");
  });
});
