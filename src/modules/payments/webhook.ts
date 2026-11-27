import type { Database } from "@/infrastructure/db/client";
import { type ProcessingOutcome, ingestProviderEvent } from "./processing";
import { type ProviderNotification, signNotification, verifyNotification } from "./notifications";
import { settleSimulatorPayment } from "./simulator";

/** Entry point for provider notifications: verify signature → record → process. */
export async function handleProviderNotification(
  db: Database,
  webhookSecret: string,
  rawBody: string,
  signatureHeader: string | null,
): Promise<ProcessingOutcome | "deferred"> {
  const notification = verifyNotification(webhookSecret, signatureHeader, rawBody);
  return ingestProviderEvent(db, { providerEventId: notification.id, source: "webhook", payment: notification.data });
}

/**
 * Job handler that "sends" a simulator notification. It signs the body and goes through exactly the same
 * verification path as the HTTP webhook route.
 */
export async function deliverSimulatorNotification(
  db: Database,
  webhookSecret: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const notification = payload.notification as ProviderNotification;
  if (payload.settle) {
    await settleSimulatorPayment(db, notification.data.providerReference, notification.data.status);
  }
  const body = JSON.stringify(notification);
  await handleProviderNotification(db, webhookSecret, body, signNotification(webhookSecret, body));
}
