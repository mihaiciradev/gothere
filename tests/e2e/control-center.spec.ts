import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { type Page, type TestInfo, expect, test } from "@playwright/test";
import { db, signUp } from "./support";

/**
 * Control Center journey through the real UI, with a simulated incident (records only; nothing real fails):
 * detection → engineering agent (runbook automation; AI is off in e2e) → package marked "not executed" → external
 * investigation requested → approved → honestly reported as not executed → resolved.
 */
async function audit(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`)).toEqual([]);
}

async function shot(page: Page, info: TestInfo, name: string) {
  if (!process.env.CAPTURE) return;
  mkdirSync("docs/reports/m4", { recursive: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `docs/reports/m4/${info.project.name}-${name}.jpg`, fullPage: true, type: "jpeg", quality: 78 });
}

test.describe("control center", () => {
  test("is not visible to attendees", async ({ page, baseURL }) => {
    await signUp(page, baseURL!);
    // Streamed pages keep the 200 already sent; what matters is that no Control Center data is rendered.
    await page.goto("/control");
    await expect(page.getByRole("heading", { name: "This page isn’t on the lineup." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "System health" })).toHaveCount(0);
  });

  test("simulated incident → agent → package not executed → approval → not executed → resolved", async ({ page, baseURL }, info) => {
    test.setTimeout(90_000);
    const email = await signUp(page, baseURL!, "Ops E2E");
    await db().query("UPDATE users SET platform_role = 'platform_admin' WHERE email = $1", [email]);

    await page.goto("/control");
    await expect(page.getByRole("heading", { name: "System health" })).toBeVisible();
    await audit(page);
    await shot(page, info, "control-health");

    // Parallel projects use different scenarios: simulated incidents with the same fingerprint deduplicate (by design).
    const scenario = info.project.name === "mobile" ? "Provider success without an order" : "Checkout requests failing";
    await page.getByRole("button", { name: `Simulate: ${scenario}` }).click();
    await expect(page).toHaveURL(/\/control\/incidents\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Simulated · demo").first()).toBeVisible();
    await expect(page.getByText("P1 major").first()).toBeVisible();

    await page.getByRole("button", { name: "Run engineering agent" }).click();
    await expect(page.getByText(/Runbook automation finished\. Investigation package generated \(not executed\)\./)).toBeVisible();
    await expect(page.getByText("Generated package · not executed").first()).toBeVisible();
    await expect(page.getByText("Runbook (no AI)")).toBeVisible();

    const download = await page.request.get(await page.getByRole("link", { name: "Download report (.md)" }).first().getAttribute("href").then((h) => h!));
    expect(download.status()).toBe(200);
    expect(await download.text()).toContain("not executed");

    await page.getByRole("button", { name: "Request external investigation" }).first().click();
    await expect(page.getByRole("button", { name: "Approve" }).first()).toBeVisible();
    await audit(page);
    await shot(page, info, "control-incident");
    await page.getByRole("button", { name: "Approve" }).first().click();
    await expect(page.getByText(/Not executed: No external coding agent is connected/).first()).toBeVisible();
    await expect(page.getByText("Generated package · not executed").first()).toBeVisible();

    await page.getByLabel("Note (required to resolve)").fill("Simulation walkthrough complete.");
    await page.getByRole("button", { name: "Resolve" }).click();
    await expect(page.getByText("Resolved. A recurrence opens a new incident.")).toBeVisible();

    for (const path of ["/control/incidents", "/control/transactions", "/control/ai"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await audit(page);
    }
    await shot(page, info, "control-ai");
  });
});
