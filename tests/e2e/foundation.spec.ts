import { expect, test } from "@playwright/test";

test("home renders the brand and security headers", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("live experiences");
});

test("auth endpoint is reachable", async ({ request }) => {
  const response = await request.get("/api/auth/ok");
  expect(response.ok()).toBe(true);
});
