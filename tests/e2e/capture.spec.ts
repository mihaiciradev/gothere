import { mkdirSync } from "node:fs";
import { test } from "@playwright/test";
import { chooseScenario, expireReservation, payViaApi, reserveViaApi, signUp } from "./support";

/**
 * Screenshots of the real interface for the milestone report. Opt-in: CAPTURE=1 pnpm test:e2e capture.
 * Writes to docs/reports/m2/<project>-<name>.jpg.
 */
test.describe("capture", () => {
  test.skip(!process.env.CAPTURE, "set CAPTURE=1 to write report screenshots");

  test("interface screenshots", async ({ page, baseURL }, info) => {
    test.setTimeout(120_000);
    const dir = "docs/reports/m2";
    mkdirSync(dir, { recursive: true });
    const shot = async (name: string, fullPage = false) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1200); // let entrance animations settle
      await page.screenshot({ path: `${dir}/${info.project.name}-${name}.jpg`, fullPage, type: "jpeg", quality: 78 });
    };

    await page.goto("/");
    await shot("home");
    await shot("home-full", true);
    await page.goto("/discover");
    await shot("discover");
    await page.goto("/events/halcyon-shore-2027");
    await shot("event");
    await page.locator("#tickets").scrollIntoViewIfNeeded();
    await shot("event-tickets");
    await page.goto("/sign-up");
    await shot("sign-up");

    await signUp(page, baseURL!, "Maya Ionescu");
    const reservationId = await reserveViaApi(page, baseURL!, "halcyon-shore-2027", "Saturday Day Pass", 2);
    await page.goto(`/checkout/${reservationId}`);
    await shot("checkout");
    await chooseScenario(page, "Decline");
    await page.getByRole("button", { name: /^Pay/ }).click();
    await page.getByRole("heading", { name: "Payment didn’t go through." }).waitFor();
    await shot("checkout-declined");
    await payViaApi(page, baseURL!, reservationId);
    await page.reload();
    await shot("checkout-confirmed");

    const expiredId = await reserveViaApi(page, baseURL!, "blue-hour-jazz-nights-2027", "Friday Only");
    await expireReservation(expiredId);
    await page.goto(`/checkout/${expiredId}`);
    await shot("checkout-expired");

    await page.goto("/tickets");
    await shot("tickets");
    await page.getByRole("link", { name: /Saturday Day Pass/ }).first().click();
    await page.getByRole("img", { name: /QR code/ }).waitFor();
    await shot("ticket", true);
  });
});
