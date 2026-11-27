export type AttemptStatus = "initiated" | "pending" | "succeeded" | "failed" | "unknown";
export type Disposition = "none" | "accepted" | "refund_required" | "refunded";
export type ProviderStatus = "pending" | "succeeded" | "failed";

/**
 * Provider-reported status transitions (mirrored by the payment_attempts trigger).
 *   initiated → pending | succeeded | failed | unknown
 *   pending   → succeeded | failed | unknown
 *   unknown   → pending | succeeded | failed
 *   succeeded, failed: terminal
 */
const attemptTransitions: Record<AttemptStatus, readonly AttemptStatus[]> = {
  initiated: ["pending", "succeeded", "failed", "unknown"],
  pending: ["succeeded", "failed", "unknown"],
  unknown: ["pending", "succeeded", "failed"],
  succeeded: [],
  failed: [],
};

export function canTransitionAttempt(from: AttemptStatus, to: AttemptStatus): boolean {
  return attemptTransitions[from].includes(to);
}

export type NotificationEffect =
  | { kind: "apply"; status: ProviderStatus }
  | { kind: "ignore"; reason: "duplicate" | "stale" };

/** Duplicate and out-of-order notifications are absorbed here, before any side effect. */
export function interpretNotification(current: AttemptStatus, reported: ProviderStatus): NotificationEffect {
  if (current === reported) return { kind: "ignore", reason: "duplicate" };
  if (!canTransitionAttempt(current, reported)) return { kind: "ignore", reason: "stale" };
  return { kind: "apply", status: reported };
}

export type SuccessDecision =
  | { kind: "accept" }
  | { kind: "refund"; reason: "late_success" | "duplicate_success" | "amount_mismatch"; expireReservation: boolean };

/**
 * What to do with a provider success. Deterministic MVP policy:
 * - accept only while the reservation is active and not past its expiry (database clock);
 * - a success after expiry never re-acquires inventory: it is recorded and marked for (simulated) refund;
 * - a second success for an already converted reservation is a duplicate charge: refund;
 * - an amount or currency different from the attempt is never accepted.
 */
export function decideSuccess(input: {
  reservationStatus: "active" | "converted" | "expired" | "released";
  reservationOverdue: boolean;
  amountMatches: boolean;
}): SuccessDecision {
  const overdueActive = input.reservationStatus === "active" && input.reservationOverdue;
  if (!input.amountMatches) return { kind: "refund", reason: "amount_mismatch", expireReservation: overdueActive };
  if (input.reservationStatus === "active" && !input.reservationOverdue) return { kind: "accept" };
  if (input.reservationStatus === "converted") return { kind: "refund", reason: "duplicate_success", expireReservation: false };
  return { kind: "refund", reason: "late_success", expireReservation: overdueActive };
}
