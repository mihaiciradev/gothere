import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { reserveViaApi, signUp } from "./support";

/** WCAG 2.1 A/AA automated checks. Serious and critical violations fail the build. */
async function audit(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`),
  ).toEqual([]);
}

test.describe("accessibility", () => {
  for (const path of ["/", "/discover", "/discover?q=zzzz-no-results", "/events/halcyon-shore-2027", "/sign-in", "/sign-up"]) {
    test(`no serious violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await audit(page);
    });
  }

  test("no serious violations on checkout and tickets", async ({ page, baseURL }) => {
    await signUp(page, baseURL!);
    const reservationId = await reserveViaApi(page, baseURL!, "blue-hour-jazz-nights-2027", "Friday Only");
    await page.goto(`/checkout/${reservationId}`);
    await page.waitForLoadState("networkidle");
    await audit(page);
    await page.goto("/tickets");
    await audit(page);
  });

  test("keyboard users can skip to content and operate the ticket stepper", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard journey on desktop");
    await page.goto("/events/blue-hour-jazz-nights-2027");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    const add = page.getByRole("button", { name: "Add one Friday Only" });
    await add.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("1 ticket · total")).toBeVisible();
  });
});
