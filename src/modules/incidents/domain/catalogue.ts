export type Severity = "P0" | "P1" | "P2" | "P3";

export const severityRank: Record<Severity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
export const higherSeverity = (a: Severity, b: Severity): Severity => (severityRank[a] <= severityRank[b] ? a : b);

/** Paths on the purchase path: failures there are a major functional degradation (P1), elsewhere limited (P2). */
const PURCHASE_PATH = /^\/api\/(reservations|payments|checkout)(\/|$)/;

export type IncidentKind = {
  source: string;
  title: (context: Record<string, unknown>) => string;
  severity: (context: Record<string, unknown>) => Severity;
  /** Where an investigator should look first. */
  modules: string[];
  /** Invariant ids (docs/invariants.md) this kind can threaten. */
  invariants: string[];
  /** Deterministic first-response guidance: the rules diagnosis when AI is not available. */
  runbook: { checks: string[]; recovery: string[]; regressionTest: string };
};

export const incidentKinds = {
  "http.unhandled_error": {
    source: "http",
    title: (c) => `Unhandled error on ${String(c.method ?? "")} ${String(c.path ?? "unknown route")}`.trim(),
    severity: (c) => (PURCHASE_PATH.test(String(c.path ?? "")) ? "P1" : "P2"),
    modules: ["src/app/api", "src/modules"],
    invariants: [],
    runbook: {
      checks: ["Open the correlated request logs by correlation id.", "Read the top stack frames; find the service called by the route.", "Check whether the error is input-dependent (reproduce with the same route and method)."],
      recovery: ["If on the purchase path, confirm no reservation or payment was left in an intermediate state (reconciliation report).", "Ship a fix through a reviewed PR; no hotfix on production data."],
      regressionTest: "An HTTP integration test calling the route with the failing input and asserting a structured error instead of a 500.",
    },
  },
  "operations.stage_failed": {
    source: "operations",
    title: (c) => `Maintenance stage failed: ${String(c.stage ?? "unknown")}`,
    severity: (c) => (String(c.stage ?? "").startsWith("payments") || c.stage === "jobs.run" ? "P1" : "P2"),
    modules: ["src/composition/runtime.ts", "src/modules/operations", "src/modules/payments", "src/modules/reservations"],
    invariants: ["JOB-1", "JOB-2", "PAY-3"],
    runbook: {
      checks: ["Run POST /api/operations/run and read failedStages.", "Check database connectivity and statement timeouts.", "Look for a single poisoned row (the sweep and job runner isolate rows, a stage failure means a systemic error)."],
      recovery: ["Fix the systemic cause; the next pass resumes automatically (stages are idempotent).", "Payment notifications and refunds wait as durable jobs; nothing is lost while the stage is down."],
      regressionTest: "An integration test injecting the failure into the stage and asserting the other stages still run.",
    },
  },
  "reservations.expiry_failed": {
    source: "reservations",
    title: () => "Overdue holds cannot be expired",
    severity: () => "P1",
    modules: ["src/modules/reservations/service.ts", "src/modules/inventory/units.ts"],
    invariants: ["INV-1", "INV-2", "RES-2"],
    runbook: {
      checks: ["Compare each affected item's reserved counter with the sum of its active holds.", "Look for writes that changed counters outside inventory.reserveUnits/releaseUnits (scripts, manual SQL).", "Check the audit trail for organizer inventory edits on those items."],
      recovery: ["Do not edit counters by hand on live data; restore consistency with a reviewed, audited repair script.", "The affected holds stay active and visible until repaired; other holds keep expiring."],
      regressionTest: "A reservations integration test that creates the inconsistent state and asserts the sweep skips it without blocking others.",
    },
  },
  "inventory.counter_mismatch": {
    source: "inventory",
    title: (c) => `Reserved counter below active holds${c.itemName ? ` for ${String(c.itemName)}` : ""}`,
    severity: () => "P1",
    modules: ["src/modules/inventory", "src/modules/reservations"],
    invariants: ["INV-1", "INV-2"],
    runbook: {
      checks: ["List active holds on the item and sum their quantities.", "Compare with inventory_items.reserved.", "Find the last writer (audit trail, deploy time, scripts run)."],
      recovery: ["Pause sales of the item if units may be oversold.", "Repair the counter with a reviewed, audited script; never in an ad-hoc session."],
      regressionTest: "A database-invariants test proving every writer moves counters only through inventory services.",
    },
  },
  "payments.unreconciled_success": {
    source: "payments",
    title: () => "Provider success without an order or refund",
    severity: () => "P1",
    modules: ["src/modules/payments/reconciliation.ts", "src/modules/payments/processing.ts"],
    invariants: ["PAY-1", "PAY-3", "PAY-5"],
    runbook: {
      checks: ["Open the reconciliation report (findUnreconciledProviderSuccesses).", "For each attempt: provider event recorded? processed? disposition?", "Check the refund job queue for dead jobs."],
      recovery: ["Let reconciliation accept or refund; never create orders by hand.", "If the refund job is dead, fix the cause and re-enqueue it through the job runner."],
      regressionTest: "A payment-reconciliation test reproducing the event sequence and asserting accept-or-refund.",
    },
  },
  "jobs.dead": {
    source: "jobs",
    title: (c) => `Background job exhausted its retries: ${String(c.jobType ?? "unknown")}`,
    severity: (c) => (String(c.jobType ?? "").startsWith("payments.") ? "P1" : "P2"),
    modules: ["src/modules/operations/jobs.ts", "src/composition/runtime.ts"],
    invariants: ["JOB-3"],
    runbook: {
      checks: ["Read the job's last_error and attempts.", "Check the handler for the job type and the payload it received.", "Check external dependencies (provider simulator) for errors at that time."],
      recovery: ["Fix the cause, then re-enqueue the job (handlers are idempotent).", "For payment jobs, confirm the attempt's disposition afterwards."],
      regressionTest: "A jobs test running the handler with the failing payload and asserting a successful, idempotent outcome.",
    },
  },
  "ai.provider_failure": {
    source: "ai",
    title: (c) => `AI provider ${String(c.kind ?? "failure")} (${String(c.feature ?? "unknown feature")})`,
    severity: () => "P3",
    modules: ["src/ai/gateway.ts", "src/ai/providers/anthropic.ts"],
    invariants: ["ACT-4"],
    runbook: {
      checks: ["Check the provider status page and the ai_usage_records error codes.", "Confirm features fell back to deterministic paths (the UI labels them)."],
      recovery: ["No action needed for ticketing: AI is not on the purchase path.", "If persistent, disable AI by unsetting AI_MODEL_FAST until the provider recovers."],
      regressionTest: "An AI gateway test with a failing scripted provider asserting the fallback path.",
    },
  },
  "ai.budget_exhausted": {
    source: "ai",
    title: () => "Monthly AI budget reached",
    severity: () => "P3",
    modules: ["src/ai/gateway.ts", "src/modules/operations/ai-usage.ts"],
    invariants: ["ACT-7"],
    runbook: {
      checks: ["Read month-to-date spend by feature in the Control Center (AI).", "Look for unusual volumes (a loop, abuse of a signed-in account)."],
      recovery: ["Features keep working on deterministic fallbacks.", "Raising AI_MONTHLY_BUDGET_MINOR is a CTO decision."],
      regressionTest: "A gateway test asserting no provider call once the budget is reserved.",
    },
  },
} satisfies Record<string, IncidentKind>;

export type IncidentKindId = keyof typeof incidentKinds;
export const isIncidentKind = (kind: string): kind is IncidentKindId => kind in incidentKinds;
