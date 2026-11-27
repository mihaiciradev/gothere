import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/infrastructure/db/client";
import { simulatorPayments } from "@/infrastructure/db/schema";
import { enqueueJob } from "@/modules/operations";
import type { ProviderStatus } from "./domain/state";
import type { ProviderNotification } from "./notifications";
import {
  type CreatePaymentRequest,
  type PaymentProvider,
  type ProviderPayment,
  ProviderTimeoutError,
  ProviderUnavailableError,
  type SimulatorScenario,
} from "./provider";

export const SIMULATOR_DELIVERY_JOB = "payments.simulator.deliver";

type Delivery = { status: ProviderStatus; delaySeconds: number; eventId?: string; settle?: boolean };

/** Outcome and notification plan per scenario. Notifications are durable jobs, like a provider's webhook queue. */
function plan(scenario: SimulatorScenario, delaySeconds: number): { status: ProviderStatus; deliveries: Delivery[] } {
  switch (scenario) {
    case "success":
      return { status: "succeeded", deliveries: [{ status: "succeeded", delaySeconds: 2 }] };
    case "decline":
      return { status: "failed", deliveries: [{ status: "failed", delaySeconds: 2 }] };
    case "delayed_success":
      return { status: "pending", deliveries: [{ status: "succeeded", delaySeconds, settle: true }] };
    case "duplicate_notification":
      return {
        status: "succeeded",
        deliveries: [
          { status: "succeeded", delaySeconds: 1, eventId: "dup" },
          { status: "succeeded", delaySeconds: 2, eventId: "dup" },
        ],
      };
    case "out_of_order":
      return {
        status: "succeeded",
        deliveries: [
          { status: "succeeded", delaySeconds: 1 },
          { status: "pending", delaySeconds: 2 },
        ],
      };
    case "timeout":
      // The provider charges but our request times out and its webhook is lost: only reconciliation can find it.
      return { status: "succeeded", deliveries: [] };
    case "unavailable":
      throw new ProviderUnavailableError();
  }
}

function toPayment(row: typeof simulatorPayments.$inferSelect): ProviderPayment {
  return {
    providerReference: row.providerReference,
    merchantReference: row.merchantReference,
    status: row.status === "refunded" ? "succeeded" : row.status,
    amountMinor: row.amountMinor,
    currency: row.currency,
    failureCode: row.status === "failed" ? "card_declined" : undefined,
  };
}

export function buildNotification(payment: ProviderPayment, eventSuffix: string): ProviderNotification {
  return {
    id: `evt_${payment.providerReference}_${eventSuffix}`,
    type: "payment.updated",
    createdAt: new Date().toISOString(),
    data: {
      providerReference: payment.providerReference,
      merchantReference: payment.merchantReference,
      status: payment.status,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      ...(payment.failureCode ? { failureCode: payment.failureCode } : {}),
    },
  };
}

/**
 * Payment provider SIMULATOR. Clearly not a real provider: no network, no money. Its ledger table stands
 * in for the provider's own records so that reconciliation can query "what the provider believes".
 */
export function createSimulatorProvider(
  db: Database,
  options: { delayedSuccessSeconds?: number; webhooks?: boolean } = {},
): PaymentProvider {
  const find = async (merchantReference: string) => {
    const [row] = await db.select().from(simulatorPayments).where(eq(simulatorPayments.merchantReference, merchantReference));
    return row;
  };

  return {
    name: "simulator",

    async createPayment(request: CreatePaymentRequest): Promise<ProviderPayment> {
      const { status, deliveries } = plan(request.scenario, options.delayedSuccessSeconds ?? 20);
      const existing = await find(request.merchantReference);
      if (existing) return toPayment(existing); // providers are idempotent on the merchant reference

      const [row] = await db
        .insert(simulatorPayments)
        .values({
          providerReference: `sim_${randomUUID().replaceAll("-", "")}`,
          merchantReference: request.merchantReference,
          amountMinor: request.amountMinor,
          currency: request.currency,
          status,
          scenario: request.scenario,
        })
        .returning();
      const payment = toPayment(row!);

      const scheduled = options.webhooks === false ? [] : deliveries;
      for (const [index, delivery] of scheduled.entries()) {
        const notification = buildNotification({ ...payment, status: delivery.status }, delivery.eventId ?? delivery.status);
        await enqueueJob(db, {
          type: SIMULATOR_DELIVERY_JOB,
          payload: { notification, settle: delivery.settle ?? false },
          delaySeconds: delivery.delaySeconds,
          dedupeKey: `sim:${notification.id}:${index}`,
        });
      }

      if (request.scenario === "timeout") throw new ProviderTimeoutError();
      return payment;
    },

    async getPayment(merchantReference: string) {
      const row = await find(merchantReference);
      return row ? toPayment(row) : null;
    },

    async refund(providerReference: string) {
      await db
        .update(simulatorPayments)
        .set({ status: "refunded" })
        .where(and(eq(simulatorPayments.providerReference, providerReference), eq(simulatorPayments.status, "succeeded")));
    },
  };
}

/** Provider side of a delayed payment: settle the ledger before the notification is "sent". */
export async function settleSimulatorPayment(db: Database, providerReference: string, status: ProviderStatus): Promise<void> {
  if (status === "pending") return;
  await db
    .update(simulatorPayments)
    .set({ status })
    .where(and(eq(simulatorPayments.providerReference, providerReference), eq(simulatorPayments.status, "pending")));
}
