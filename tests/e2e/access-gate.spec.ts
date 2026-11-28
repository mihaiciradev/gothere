import { type ConsoleMessage, expect, test } from "@playwright/test";

/**
 * The pre-release access gate, against a second server started with SITE_ACCESS_PASSWORD (playwright.config.ts),
 * and the Content Security Policy on the ungated server. Desktop only: the behaviour is device-independent.
 */
const gated = process.env.E2E_GATED_URL!;
const password = process.env.E2E_GATE_PASSWORD!;

test.describe("access gate", () => {
  test.skip(({ isMobile }) => isMobile, "device-independent");

  test("sends visitors to the gate and refuses API calls without the access cookie", async ({ page, request }) => {
    await page.goto(`${gated}/discover?q=jazz`);
    await expect(page).toHaveURL(`${gated}/access?next=%2Fdiscover%3Fq%3Djazz`);
    await expect(page.getByRole("heading", { name: "Private preview" })).toBeVisible();

    const api = await request.get(`${gated}/api/events`);
    expect(api.status()).toBe(401);
    expect(await api.json()).toMatchObject({ error: { message: "This preview is password-protected." } });
    const concierge = await request.post(`${gated}/api/concierge`, { data: { message: "jazz" }, headers: { origin: gated } });
    expect(concierge.status()).toBe(401);
  });

  test("keeps the privacy notice and self-authenticating machine endpoints reachable", async ({ request }) => {
    expect((await request.get(`${gated}/privacy`)).status()).toBe(200);
    // Cron: reaches the route, which applies its own bearer check (not the gate's message).
    const cron = await request.post(`${gated}/api/operations/run`, { headers: { authorization: "Bearer wrong" } });
    expect(cron.status()).toBe(401);
    expect(JSON.stringify(await cron.json())).not.toContain("password-protected");
    // Provider webhook: reaches the route, which rejects the missing signature itself.
    const webhook = await request.post(`${gated}/api/payments/simulator/webhook`, { data: {} });
    expect(JSON.stringify(await webhook.json())).not.toContain("password-protected");
  });

  test("a wrong password is refused; the right one opens the site and returns to the requested page", async ({ page }) => {
    await page.goto(`${gated}/discover`);
    await page.getByLabel("Access password").fill("definitely-not-it");
    await page.getByRole("button", { name: "Enter" }).click();
    await expect(page.getByText("That password is not right.")).toBeVisible();

    await page.getByLabel("Access password").fill(password);
    await page.getByRole("button", { name: "Enter" }).click();
    await expect(page).toHaveURL(`${gated}/discover`);
    await expect(page.getByRole("heading", { name: "Find your next night out." })).toBeVisible();
    const cookie = (await page.context().cookies(gated)).find((c) => c.name === "gt_access");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });
    expect((await page.request.get(`${gated}/api/events`)).status()).toBe(200);
  });

  test("a forged or expired cookie does not pass", async ({ page }) => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    await page.context().addCookies([{ name: "gt_access", value: `${future}.forged-signature`, url: gated }]);
    expect((await page.request.get(`${gated}/api/events`)).status()).toBe(401);
  });
});

test.describe("content security policy", () => {
  test("is sent on pages and produces no violations on the main journeys", async ({ page }) => {
    const violations: string[] = [];
    const collect = (m: ConsoleMessage) => {
      if (/Content Security Policy|Refused to (load|execute|connect|apply)/i.test(m.text())) violations.push(m.text());
    };
    page.on("console", collect);
    for (const path of ["/", "/discover", "/events/halcyon-shore-2027", "/privacy", "/sign-in"]) {
      const response = await page.goto(path);
      const csp = response!.headers()["content-security-policy"] ?? "";
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("img-src 'self' data: blob: https://images.unsplash.com");
      await page.waitForLoadState("networkidle");
    }
    expect(violations).toEqual([]);
  });
});
