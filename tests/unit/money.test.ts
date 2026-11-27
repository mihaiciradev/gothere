import { describe, expect, it } from "vitest";
import { addMoney, formatMoney, money, multiplyMoney, sumMoney } from "@/shared/money";

describe("money", () => {
  it("adds and multiplies in integer minor units", () => {
    expect(addMoney(money(1999, "EUR"), money(1, "EUR"))).toEqual({ amountMinor: 2000, currency: "EUR" });
    expect(multiplyMoney(money(3500, "EUR"), 150)).toEqual({ amountMinor: 525000, currency: "EUR" });
    expect(sumMoney([money(10, "EUR"), money(20, "EUR")], "EUR").amountMinor).toBe(30);
  });

  it("rejects fractional amounts, mixed currencies and invalid quantities", () => {
    expect(() => money(10.5, "EUR")).toThrow();
    expect(() => addMoney(money(1, "EUR"), money(1, "RON"))).toThrow();
    expect(() => multiplyMoney(money(1, "EUR"), -1)).toThrow();
    expect(() => multiplyMoney(money(1, "EUR"), 1.5)).toThrow();
  });

  it("formats for presentation without altering stored values", () => {
    expect(formatMoney(money(525000, "EUR"))).toMatch(/5,250\.00/);
  });
});
