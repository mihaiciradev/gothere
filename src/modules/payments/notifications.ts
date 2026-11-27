import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/shared/errors";

export const providerNotificationSchema = z
  .object({
    id: z.string().min(8).max(200),
    type: z.literal("payment.updated"),
    createdAt: z.iso.datetime(),
    data: z
      .object({
        providerReference: z.string().min(4).max(200),
        merchantReference: z.uuid(),
        status: z.enum(["pending", "succeeded", "failed"]),
        amountMinor: z.number().int().min(0),
        currency: z.string().regex(/^[A-Z]{3}$/),
        failureCode: z.string().max(100).optional(),
      })
      .strict(),
  })
  .strict();

export type ProviderNotification = z.infer<typeof providerNotificationSchema>;

const SIGNATURE_TOLERANCE_SECONDS = 300;

function hmac(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function signNotification(secret: string, body: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  return `t=${nowSeconds},v1=${hmac(secret, nowSeconds, body)}`;
}

/**
 * Verifies `t=<unix>,v1=<hex hmac>` over `${t}.${body}` with a 5-minute replay window, in constant time.
 * Without a valid signature a notification is rejected before it is parsed or stored.
 */
export function verifyNotification(
  secret: string,
  header: string | null,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): ProviderNotification {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const timestamp = Number(parts.t);
  const signature = parts.v1 ?? "";
  if (!Number.isInteger(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) {
    throw new AppError("UNAUTHENTICATED", "Invalid notification signature.");
  }
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    throw new AppError("UNAUTHENTICATED", "Notification signature expired.");
  }
  const expected = Buffer.from(hmac(secret, timestamp, body), "hex");
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) {
    throw new AppError("UNAUTHENTICATED", "Invalid notification signature.");
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new AppError("VALIDATION_FAILED", "Notification body is not JSON.");
  }
  return providerNotificationSchema.parse(json);
}
