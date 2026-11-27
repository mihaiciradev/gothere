import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/shared/redirect";

describe("safe redirect after sign-in", () => {
  it("keeps same-origin attendee paths with their query", () => {
    expect(safeRedirectPath("/events/halcyon-shore-2027?ticket=1")).toBe("/events/halcyon-shore-2027?ticket=1");
    expect(safeRedirectPath("/checkout/abc")).toBe("/checkout/abc");
    expect(safeRedirectPath("/tickets")).toBe("/tickets");
    expect(safeRedirectPath("/organizer/approvals?org=tidal-assembly")).toBe("/organizer/approvals?org=tidal-assembly");
    expect(safeRedirectPath("/")).toBe("/");
  });

  it("keeps percent-encoded characters encoded rather than decoding them into headers", () => {
    expect(safeRedirectPath("/events/%0d%0aSet-Cookie:x")).toBe("/events/%0d%0aSet-Cookie:x");
  });

  it("rejects open-redirect and injection attempts", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example/events",
      "/\\evil.example",
      "/events/\nx",
      "javascript:alert(1)",
      "/api/auth/sign-out",
      "/control",
      "/organizerevil",
      "/ticketsevil",
      "",
      null,
      42,
    ]) {
      expect(safeRedirectPath(bad), String(bad)).toBe("/");
    }
  });
});
