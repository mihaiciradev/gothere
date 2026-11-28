import type { IncidentKindId } from "./catalogue";

export type EventFacts = {
  id: string;
  occurredAt: Date;
  correlationId: string | null;
  context: Record<string, unknown>;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : null);
const distinct = <T>(values: (T | null | undefined)[]) => [...new Set(values.filter((v): v is T => v !== null && v !== undefined))];

/** Facts about the failure itself: how often, since when, where. */
export function technicalImpact(events: EventFacts[]) {
  const times = events.map((e) => e.occurredAt.getTime());
  return {
    occurrences: events.length,
    firstSeenAt: events.length ? new Date(Math.min(...times)).toISOString() : null,
    lastSeenAt: events.length ? new Date(Math.max(...times)).toISOString() : null,
    correlationIds: distinct(events.map((e) => e.correlationId)).slice(0, 10),
    routes: distinct(events.map((e) => str(e.context.path))).slice(0, 10),
    errorNames: distinct(events.map((e) => str(e.context.errorName))).slice(0, 5),
    stages: distinct(events.map((e) => str(e.context.stage))).slice(0, 5),
    jobTypes: distinct(events.map((e) => str(e.context.jobType))).slice(0, 5),
  };
}

/**
 * What the failure means for the business, from amounts the detectors read from the database. Where no amount can be
 * known (a failed request), impact is counted, never estimated in money.
 */
export function commercialImpact(kind: IncidentKindId, events: EventFacts[]): Record<string, unknown> {
  const currency = distinct(events.map((e) => str(e.context.currency)))[0] ?? null;
  switch (kind) {
    case "payments.unreconciled_success": {
      const attempts = new Map(events.map((e) => [str(e.context.attemptId), num(e.context.amountMinor)]));
      attempts.delete(null);
      return {
        summary: "Customers were charged (simulated) without a confirmed order or refund.",
        payments: attempts.size,
        amountAtRiskMinor: [...attempts.values()].reduce((a, b) => a + b, 0),
        currency,
      };
    }
    case "inventory.counter_mismatch":
    case "reservations.expiry_failed": {
      const latest = new Map<string, EventFacts>();
      for (const e of events) {
        const item = str(e.context.inventoryItemId) ?? str(e.context.reservationId) ?? e.id;
        const prev = latest.get(item);
        if (!prev || prev.occurredAt < e.occurredAt) latest.set(item, e);
      }
      const units = [...latest.values()].reduce((s, e) => s + num(e.context.missingUnits ?? e.context.quantity), 0);
      const value = [...latest.values()].reduce((s, e) => s + num(e.context.missingUnits ?? e.context.quantity) * num(e.context.unitPriceMinor), 0);
      return {
        summary: "Held units are not counted correctly: they may never be released (lost sales) or be sold twice.",
        affectedItems: distinct(events.map((e) => str(e.context.inventoryItemId))).length,
        affectedHolds: distinct(events.map((e) => str(e.context.reservationId))).length,
        unitsAtRisk: units,
        valueAtRiskMinor: value,
        currency,
      };
    }
    case "jobs.dead": {
      const payment = events.filter((e) => str(e.context.jobType)?.startsWith("payments."));
      return {
        summary: payment.length
          ? "Payment follow-up work (notification, verification or refund) stopped retrying."
          : "Background housekeeping stopped retrying; no payment work affected.",
        jobs: distinct(events.map((e) => str(e.context.jobId))).length,
        amountAtRiskMinor: payment.reduce((s, e) => s + num(e.context.amountMinor), 0),
        currency,
      };
    }
    case "http.unhandled_error":
      return {
        summary: events.some((e) => /^\/api\/(reservations|payments|checkout)/.test(String(e.context.path ?? "")))
          ? "Requests on the purchase path failed; each may be an abandoned purchase. No amount is inferred."
          : "Requests failed outside the purchase path.",
        failedRequests: events.length,
      };
    case "operations.stage_failed":
      return { summary: "Maintenance was delayed. Correctness does not depend on it (database-clock checks), but refunds and confirmations wait.", failedPasses: events.length };
    case "ai.provider_failure":
    case "ai.budget_exhausted":
      return { summary: "AI features fell back to deterministic behaviour. No ticketing impact.", affectedCalls: events.length };
  }
}
