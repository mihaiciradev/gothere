import { test } from "@playwright/test";

/**
 * Field-style measurements on the production build (opt-in: METRICS=1). Prints LCP, CLS and transferred
 * bytes per page. Local machine, local database, no CDN: indicative, not a production benchmark.
 */
test.describe("metrics", () => {
  test.skip(!process.env.METRICS, "set METRICS=1 to print page metrics");

  for (const path of ["/", "/discover", "/events/halcyon-shore-2027", "/sign-in"]) {
    test(`metrics ${path}`, async ({ page }, info) => {
      await page.addInitScript(() => {
        const w = window as unknown as { __lcp: number; __cls: number };
        w.__lcp = 0;
        w.__cls = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) w.__lcp = e.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
            if (!e.hadRecentInput) w.__cls += e.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1500);
      const m = await page.evaluate(() => {
        const w = window as unknown as { __lcp: number; __cls: number };
        const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        const kb = (filter: (r: PerformanceResourceTiming) => boolean) =>
          Math.round(resources.filter(filter).reduce((s, r) => s + (r.encodedBodySize || r.transferSize), 0) / 1024);
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        return {
          ttfbMs: Math.round(nav.responseStart),
          lcpMs: Math.round(w.__lcp),
          cls: Number(w.__cls.toFixed(3)),
          jsKb: kb((r) => r.name.endsWith(".js") || r.initiatorType === "script"),
          imageKb: kb((r) => r.initiatorType === "img" || r.name.includes("images.unsplash.com")),
          fontKb: kb((r) => /\.woff2?$/.test(r.name)),
        };
      });
      console.info(`METRIC ${info.project.name} ${path} ${JSON.stringify(m)}`);
    });
  }
});
