import { describe, expect, it } from "vitest";
import { availableUnits } from "@/modules/inventory/domain/availability";
import {
  type AttemptStatus,
  canTransitionAttempt,
  decideSuccess,
  interpretNotification,
} from "@/modules/payments/domain/state";
import { signNotification, verifyNotification } from "@/modules/payments/notifications";
import { backoffSeconds } from "@/modules/operations/jobs";
import { canTransitionReservation, canonicalReservationRequest } from "@/modules/reservations/domain/policy";
import { generateTicketCode } from "@/modules/ticketing/confirmation";

describe("payment attempt state machine", () => {
  const all: AttemptStatus[] = ["initiated", "pending", "succeeded", "failed", "unknown"];

  it("treats succeeded as terminal and lets only a success follow a failure", () => {
    for (const to of all) {
      expect(canTransitionAttempt("succeeded", to)).toBe(false);
      expect(canTransitionAttempt("failed", to)).toBe(to === "succeeded");
    }
  });

  it("allows resolution of ambiguous states", () => {
    expect(canTransitionAttempt("unknown", "succeeded")).toBe(true);
    expect(canTransitionAttempt("pending", "succeeded")).toBe(true);
    expect(canTransitionAttempt("pending", "initiated")).toBe(false);
  });

  it("absorbs duplicate and out-of-order notifications", () => {
    expect(interpretNotification("succeeded", "succeeded")).toEqual({ kind: "ignore", reason: "duplicate" });
    expect(interpretNotification("succeeded", "pending")).toEqual({ kind: "ignore", reason: "stale" });
    expect(interpretNotification("failed", "pending")).toEqual({ kind: "ignore", reason: "stale" });
    expect(interpretNotification("failed", "succeeded")).toEqual({ kind: "apply", status: "succeeded" });
    expect(interpretNotification("pending", "succeeded")).toEqual({ kind: "apply", status: "succeeded" });
  });
});

describe("provider success policy", () => {
  it("accepts only an active, unexpired reservation with a matching amount", () => {
    expect(decideSuccess({ reservationStatus: "active", reservationOverdue: false, amountMatches: true })).toEqual({ kind: "accept" });
    expect(decideSuccess({ reservationStatus: "active", reservationOverdue: true, amountMatches: true })).toEqual({
      kind: "refund",
      reason: "late_success",
      expireReservation: true,
    });
    expect(decideSuccess({ reservationStatus: "expired", reservationOverdue: true, amountMatches: true })).toMatchObject({
      reason: "late_success",
      expireReservation: false,
    });
    expect(decideSuccess({ reservationStatus: "converted", reservationOverdue: false, amountMatches: true })).toMatchObject({
      reason: "duplicate_success",
    });
    expect(decideSuccess({ reservationStatus: "active", reservationOverdue: false, amountMatches: false })).toMatchObject({
      reason: "amount_mismatch",
      expireReservation: false,
    });
  });
});

describe("reservation rules", () => {
  it("only leaves the active state", () => {
    expect(canTransitionReservation("active", "converted")).toBe(true);
    expect(canTransitionReservation("expired", "converted")).toBe(false);
    expect(canTransitionReservation("converted", "released")).toBe(false);
  });

  it("canonicalizes requests independently of line order", () => {
    const a = canonicalReservationRequest({ eventId: "e", items: [{ inventoryItemId: "b", quantity: 1 }, { inventoryItemId: "a", quantity: 2 }] });
    const b = canonicalReservationRequest({ eventId: "e", items: [{ inventoryItemId: "a", quantity: 2 }, { inventoryItemId: "b", quantity: 1 }] });
    const c = canonicalReservationRequest({ eventId: "e", items: [{ inventoryItemId: "a", quantity: 3 }, { inventoryItemId: "b", quantity: 1 }] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("availability", () => {
  it("counts overdue holds as available and never exceeds capacity minus sold", () => {
    expect(availableUnits({ capacity: 10, reserved: 4, sold: 3, overdueHeld: 0 })).toBe(3);
    expect(availableUnits({ capacity: 10, reserved: 4, sold: 3, overdueHeld: 4 })).toBe(7);
    expect(availableUnits({ capacity: 10, reserved: 0, sold: 10, overdueHeld: 0 })).toBe(0);
  });
});

describe("provider notification signatures", () => {
  const secret = "s".repeat(40);
  const body = JSON.stringify({
    id: "evt_test_00001",
    type: "payment.updated",
    createdAt: new Date().toISOString(),
    data: {
      providerReference: "sim_123",
      merchantReference: "6f1c2b8e-2f4f-4a51-9b0e-1d7f1c9a7e10",
      status: "succeeded",
      amountMinor: 3500,
      currency: "EUR",
    },
  });

  it("accepts a fresh, correctly signed body", () => {
    expect(verifyNotification(secret, signNotification(secret, body), body).data.amountMinor).toBe(3500);
  });

  it("rejects wrong secrets, tampering, replays and malformed headers", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(() => verifyNotification(secret, signNotification("t".repeat(40), body), body)).toThrow();
    expect(() => verifyNotification(secret, signNotification(secret, body), body.replace("3500", "1"))).toThrow();
    expect(() => verifyNotification(secret, signNotification(secret, body, now - 600), body, now)).toThrow();
    expect(() => verifyNotification(secret, "garbage", body)).toThrow();
  });
});

describe("operations and tickets", () => {
  it("backs off exponentially with a ceiling", () => {
    expect([1, 2, 3, 4].map(backoffSeconds)).toEqual([5, 10, 20, 40]);
    expect(backoffSeconds(20)).toBe(900);
  });

  it("generates unguessable, well-formed ticket codes", () => {
    const codes = new Set(Array.from({ length: 2000 }, generateTicketCode));
    expect(codes.size).toBe(2000);
    for (const code of codes) expect(code).toMatch(/^GT-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  });
});
