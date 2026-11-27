import { expect, test } from "@playwright/test";
import { chooseScenario, expireReservation, makeJobsDue, payViaApi, reserveViaApi, signUp } from "./support";

const JAZZ = "blue-hour-jazz-nights-2027";

test.describe("attendee journey", () => {
  test("discovery → event → sign-up → reservation → checkout → payment → ticket", async ({ page, isMobile }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    if (isMobile) {
      await page.getByRole("button", { name: "Menu" }).click();
      await page.getByRole("navigation", { name: "Mobile" }).getByRole("link", { name: "Discover" }).click();
    } else {
      await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Discover" }).click();
    }
    await expect(page).toHaveURL(/\/discover$/);

    // Next keeps visited pages mounted (hidden), so target this page's search box by id.
    await page.locator("#q").fill("jazz");
    await page.locator("#q").press("Enter");
    await expect(page.getByText(/1 event matching “jazz”/)).toBeVisible();
    await page.getByRole("link", { name: /Blue Hour Jazz Nights/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Blue Hour");

    await page.getByRole("button", { name: "Add one Friday Only" }).click();
    await expect(page.getByText("1 ticket · total")).toBeVisible();
    if (isMobile) await page.getByRole("button", { name: /^Reserve 1/ }).click();
    else await page.locator("#tickets").getByRole("button", { name: /^Reserve/ }).click();

    // Signed out: sent to sign-in with the selection preserved, then on to sign-up.
    await expect(page).toHaveURL(/\/sign-in\?next=/);
    await page.getByRole("link", { name: "Create an account" }).click();
    await page.getByLabel("Name").fill("Journey Tester");
    await page.getByLabel("Email").fill(`journey-${crypto.randomUUID()}@example.test`);
    await page.getByLabel("Password").fill(`e2e-${crypto.randomUUID()}`);
    await page.getByRole("button", { name: /Create account/ }).click();

    await expect(page).toHaveURL(new RegExp(`/events/${JAZZ}\\?select=`));
    await expect(page.getByText("1 ticket · total")).toBeVisible();
    if (isMobile) await page.getByRole("button", { name: /^Reserve 1/ }).click();
    else await page.locator("#tickets").getByRole("button", { name: /^Reserve/ }).click();

    await expect(page).toHaveURL(/\/checkout\//);
    await expect(page.getByText("Simulated payment", { exact: true })).toBeVisible();
    await expect(page.getByText("Tickets held for")).toBeVisible();
    await page.getByRole("button", { name: /^Pay €40/ }).click();
    await expect(page.getByRole("heading", { name: "You’re going." })).toBeVisible();

    await page.getByRole("link", { name: /View my tickets/ }).click();
    await expect(page.getByRole("heading", { name: "My tickets" })).toBeVisible();
    await page.getByRole("link", { name: /Friday Only/ }).first().click();
    await expect(page.getByRole("img", { name: /QR code for ticket GT-/ })).toBeVisible();
    await expect(page.getByText("Display only — entry scanning and validation are not part of this prototype.")).toBeVisible();
  });

  test("a declined payment can be retried", async ({ page, baseURL }) => {
    await signUp(page, baseURL!);
    const reservationId = await reserveViaApi(page, baseURL!, JAZZ, "Friday Only");
    await page.goto(`/checkout/${reservationId}`);
    await page.waitForLoadState("networkidle"); // interact only once hydrated

    await chooseScenario(page, "Decline");
    await page.getByRole("button", { name: /^Pay/ }).click();
    await expect(page.getByRole("heading", { name: "Payment didn’t go through." })).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Your tickets are still held");

    await chooseScenario(page, "Approve");
    await page.getByRole("button", { name: /^Try again/ }).click();
    await expect(page.getByRole("heading", { name: "You’re going." })).toBeVisible();
  });

  test("an expired hold cannot be paid and says so", async ({ page, baseURL }) => {
    await signUp(page, baseURL!);
    const reservationId = await reserveViaApi(page, baseURL!, JAZZ, "Friday Only");
    await expireReservation(reservationId);

    await page.goto(`/checkout/${reservationId}`);
    await page.waitForLoadState("networkidle"); // interact only once hydrated
    await expect(page.getByRole("heading", { name: "Time ran out." })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Pay/ })).toHaveCount(0);
  });

  test("refreshing during a pending payment resumes and confirms", async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    await signUp(page, baseURL!);
    const reservationId = await reserveViaApi(page, baseURL!, JAZZ, "Friday Only");
    await page.goto(`/checkout/${reservationId}`);
    await page.waitForLoadState("networkidle"); // interact only once hydrated

    await chooseScenario(page, "Delayed");
    await page.getByRole("button", { name: /^Pay/ }).click();
    // Wait for the provider's pending answer to be recorded (not just the request being in flight).
    await expect(page.getByText("Waiting for confirmation")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Waiting for confirmation")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Confirming your payment." })).toBeVisible();

    // The provider's confirmation is due now; the page's own polling advances background work.
    await makeJobsDue();
    await expect(page.getByRole("heading", { name: "You’re going." })).toBeVisible({ timeout: 30_000 });
  });

  test("sold-out inventory cannot be selected", async ({ page }) => {
    await page.goto("/events/halcyon-shore-2027");
    const panel = page.locator("#tickets");
    await expect(panel.getByText("Sunset Sessions · Saturday")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Add one Sunset Sessions · Saturday" })).toHaveCount(0);
    await expect(panel.getByText("Sold out", { exact: true })).toBeVisible();
  });

  test("another attendee's ticket and checkout are not found", async ({ browser, page, baseURL }) => {
    await signUp(page, baseURL!, "Owner");
    const reservationId = await reserveViaApi(page, baseURL!, JAZZ, "Friday Only");
    await payViaApi(page, baseURL!, reservationId);
    const { data: tickets } = await (await page.request.get("/api/me/tickets")).json();
    const ticketId = tickets[0].id as string;

    const intruderContext = await browser.newContext();
    const intruder = await intruderContext.newPage();
    await signUp(intruder, baseURL!, "Intruder");
    for (const path of [`/tickets/${ticketId}`, `/checkout/${reservationId}`]) {
      await intruder.goto(path);
      await expect(intruder.getByRole("heading", { name: "This page isn’t on the lineup." })).toBeVisible();
    }
    await intruderContext.close();
  });

  test("tickets and checkout require sign-in and return afterwards", async ({ page }) => {
    await page.goto("/tickets");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Ftickets/);
  });

  test("the browser never talks to an AI provider, and keyword search works without the concierge", async ({ page }) => {
    const providerRequests: string[] = [];
    page.on("request", (r) => /anthropic|openai/i.test(r.url()) && providerRequests.push(r.url()));

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByLabel(/Describe what you’re looking for/).fill("sunset");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByText(/Plain search · no AI involved|AI picks from live listings/)).toBeVisible();

    await page.goto("/discover?q=sunset");
    await expect(page.getByRole("link", { name: /Halcyon Shore 2027/ }).first()).toBeVisible();
    expect(providerRequests).toEqual([]);
  });
});
