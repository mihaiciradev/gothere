import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { higherSeverity, incidentKinds } from "@/modules/incidents/domain/catalogue";
import { commercialImpact, technicalImpact } from "@/modules/incidents/domain/impact";
import { normalizePath, sanitizeText, sanitizeValue, stackFrames } from "@/modules/incidents/domain/sanitize";

describe("sanitization", () => {
  it("removes credentials, tokens, emails and card-like numbers but keeps ids and codes", () => {
    const id = "7d1c3c0e-8a5a-4b8e-9d5e-1f0f0c0b0a09";
    const text = sanitizeText(
      `user ana@example.com failed with postgres://app:s3cret@ep-x.neon.tech/db, Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXZhbHVl, key sk-ant-abcdefghijklmnopqrstuv, card 4111 1111 1111 1111, reservation ${id}, code PRECONDITION_FAILED`,
    );
    for (const secret of ["ana@example.com", "s3cret", "eyJhbGci", "sk-ant-abcdef", "4111 1111"]) expect(text).not.toContain(secret);
    expect(text).toContain(id);
    expect(text).toContain("PRECONDITION_FAILED");
  });

  it("redacts secret-named keys at any depth and bounds size", () => {
    const value = sanitizeValue({ a: { password: "x", nested: { apiKey: "y", ok: "keep" } }, list: Array.from({ length: 50 }, (_, i) => i), long: "z".repeat(1000) }) as Record<string, unknown>;
    expect(JSON.stringify(value)).not.toMatch(/"x"|"y"/);
    expect((value.a as { nested: { ok: string } }).nested.ok).toBe("keep");
    expect((value.list as unknown[]).length).toBe(20);
    expect((value.long as string).length).toBeLessThanOrEqual(301);
  });

  it("normalises ids out of paths so one failing route is one fingerprint", () => {
    expect(normalizePath("/api/reservations/7d1c3c0e-8a5a-4b8e-9d5e-1f0f0c0b0a09/payments?x=1")).toBe("/api/reservations/:id/payments");
    expect(normalizePath("/api/items/42/edit")).toBe("/api/items/:n/edit");
  });

  it("keeps project stack frames as file:line without absolute paths", () => {
    const error = new Error("x");
    error.stack = "Error: x\n    at f (E:\\gothere\\src\\modules\\payments\\service.ts:142:9)\n    at g (/home/runner/work/gothere/node_modules/pg/lib/client.js:10:3)\n    at node:internal/process:1:1";
    expect(stackFrames(error)).toEqual(["src/modules/payments/service.ts:142"]);
  });
});

describe("classification and impact", () => {
  it("only ever raises severity", () => {
    expect(higherSeverity("P2", "P1")).toBe("P1");
    expect(higherSeverity("P0", "P3")).toBe("P0");
  });

  it("classifies purchase-path failures as major and other routes as limited", () => {
    expect(incidentKinds["http.unhandled_error"].severity({ path: "/api/reservations/:id/payments" })).toBe("P1");
    expect(incidentKinds["http.unhandled_error"].severity({ path: "/api/events" })).toBe("P2");
    expect(incidentKinds["jobs.dead"].severity({ jobType: "payments.simulated_refund" })).toBe("P1");
    expect(incidentKinds["jobs.dead"].severity({ jobType: "housekeeping" })).toBe("P2");
  });

  it("references only invariants that exist in docs/invariants.md", () => {
    const documented = readFileSync("docs/invariants.md", "utf8");
    for (const kind of Object.values(incidentKinds)) for (const id of kind.invariants) expect(documented).toContain(`| ${id} |`);
  });

  it("counts money only from recorded amounts and never double counts a payment", () => {
    const at = new Date("2026-11-28T10:00:00Z");
    const events = [
      { id: "e1", occurredAt: at, correlationId: "c1", context: { attemptId: "a1", amountMinor: 8900, currency: "EUR" } },
      { id: "e2", occurredAt: at, correlationId: "c2", context: { attemptId: "a1", amountMinor: 8900, currency: "EUR" } },
      { id: "e3", occurredAt: at, correlationId: null, context: { attemptId: "a2", amountMinor: 3500, currency: "EUR" } },
    ];
    expect(commercialImpact("payments.unreconciled_success", events)).toMatchObject({ payments: 2, amountAtRiskMinor: 12_400, currency: "EUR" });
    expect(commercialImpact("http.unhandled_error", events)).not.toHaveProperty("amountAtRiskMinor");
    expect(technicalImpact(events)).toMatchObject({ occurrences: 3, correlationIds: ["c1", "c2"] });
  });
});
