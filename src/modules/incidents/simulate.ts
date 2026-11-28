import { z } from "zod";
import type { DbExecutor } from "@/infrastructure/db/client";
import { recordAudit } from "@/modules/audit";
import { type Actor, requirePlatformAdminById } from "@/modules/identity";
import { AppError } from "@/shared/errors";
import { type RecordedEvent, recordOperationalEvent } from "./recorder";

/**
 * Demonstration incidents. They are records only, stored with origin `simulated` and their own fingerprints: nothing
 * fails, no real data is touched, and the Control Center labels them apart from live telemetry. Real incidents are
 * never triggered deliberately.
 */
export const simulationScenarios = {
  "checkout-errors": {
    label: "Checkout requests failing",
    events: 3,
    build: (i: number) => ({
      kind: "http.unhandled_error" as const,
      message: "TypeError: Cannot read properties of undefined (reading 'priceMinor')",
      correlationId: `sim-${crypto.randomUUID()}`,
      context: { method: "POST", path: "/api/reservations/:id/payments", errorName: "TypeError", frames: ["src/modules/payments/service.ts:142", "src/app/api/reservations/[id]/payments/route.ts:18"], attempt: i },
      fingerprintParts: ["POST", "/api/reservations/:id/payments", "TypeError"],
    }),
  },
  "payment-unreconciled": {
    label: "Provider success without an order",
    events: 2,
    build: (i: number) => ({
      kind: "payments.unreconciled_success" as const,
      message: `Provider success sim_ref_${i} has no accepted order or refund.`,
      context: { providerReference: `sim_ref_${i}`, attemptId: `sim-attempt-${i}`, outcome: null, amountMinor: 8900 * (i + 1), currency: "EUR" },
      dedupeKey: `sim_ref_${i}:${crypto.randomUUID()}`,
    }),
  },
  "ai-degraded": {
    label: "AI provider timeouts",
    events: 4,
    build: () => ({
      kind: "ai.provider_failure" as const,
      message: "AI call failed: timeout",
      context: { feature: "concierge", kind: "timeout" },
      fingerprintParts: ["concierge", "timeout"],
    }),
  },
} as const;

export type SimulationScenario = keyof typeof simulationScenarios;
export const simulationSchema = z.object({ scenario: z.enum(Object.keys(simulationScenarios) as [SimulationScenario, ...SimulationScenario[]]) }).strict();

export async function createSimulatedIncident(db: DbExecutor, actor: Actor, input: unknown, options: { allowed: boolean; correlationId?: string }) {
  await requirePlatformAdminById(db, actor.userId);
  if (!options.allowed) throw new AppError("FORBIDDEN", "Simulations are disabled in this environment.");
  const { scenario } = simulationSchema.parse(input);
  const definition = simulationScenarios[scenario];
  let last: RecordedEvent | null = null;
  for (let i = 0; i < definition.events; i++) {
    last = (await recordOperationalEvent(db, { ...definition.build(i), origin: "simulated" })) ?? last;
  }
  if (!last) throw new AppError("INTERNAL", "The simulated incident could not be recorded.");
  await recordAudit(db, { actorType: "user", actorUserId: actor.userId, action: "incident.simulate", targetType: "incident", targetId: last.incidentId, outcome: "succeeded", correlationId: options.correlationId, metadata: { scenario } });
  return { incidentId: last.incidentId, scenario };
}
