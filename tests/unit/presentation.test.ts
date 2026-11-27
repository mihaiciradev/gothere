import { describe, expect, it } from "vitest";
import { formatDateRange, formatPrice, formatStamp, formatTime } from "@/components/format";
import { availabilityStatus } from "@/modules/events/domain/availability-status";
import { assertUuid, isUuid } from "@/shared/ids";

describe("availability status", () => {
  it("maps remaining capacity to a coarse public signal", () => {
    expect(availabilityStatus(500, 1000)).toBe("available");
    expect(availabilityStatus(100, 1000)).toBe("limited");
    expect(availabilityStatus(0, 1000)).toBe("sold_out");
    expect(availabilityStatus(0, 0)).toBe("not_on_sale");
  });
});

describe("presentation formatting", () => {
  it("drops decimals only for whole amounts", () => {
    expect(formatPrice(8900, "EUR")).toBe("€89");
    expect(formatPrice(8950, "EUR")).toBe("€89.50");
  });

  it("renders times in the event's time zone, not the viewer's", () => {
    const start = new Date("2027-07-10T16:30:00Z"); // 19:30 in Bucharest (UTC+3)
    expect(formatTime(start, "Europe/Bucharest")).toBe("19:30");
    expect(formatStamp(start, "Europe/Bucharest")).toEqual({ day: "10", month: "JUL", year: "2027" });
  });

  it("treats a festival's after-midnight finish as the previous day", () => {
    // Ends 04:00 local on the 12th: the last night belongs to the 11th.
    const range = formatDateRange(new Date("2027-07-09T11:00:00Z"), new Date("2027-07-12T01:00:00Z"), "Europe/Bucharest");
    expect(range).toBe("9–11 Jul 2027");
  });
});

describe("ids", () => {
  it("rejects malformed ids as not found rather than reaching the database", () => {
    expect(isUuid("6f1c2b8e-2f4f-4a51-9b0e-1d7f1c9a7e10")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(() => assertUuid("1 OR 1=1", "Ticket")).toThrowError(/Ticket not found/);
  });
});
