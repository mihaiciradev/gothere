import { describe, expect, it } from "vitest";
import { canonicalJson, paramsHash } from "@/actions/canonical";
import { costMicroUsd } from "@/ai/gateway";
import { parseIntent } from "@/ai/intent";
import { shiftLocalDays } from "@/modules/analytics/domain/local-time";
import { type SessionDemand, groundedNumbers, proposeAdditionalSession, rulesNarrative, ungroundedNumbers } from "@/modules/analytics/domain/opportunity";

const session = (overrides: Partial<SessionDemand> = {}): SessionDemand => ({
  inventoryItemId: "item",
  experienceId: "exp",
  experienceSlug: "sunset-sessions-pier",
  experienceTitle: "Sunset Sessions on the Pier",
  itemName: "Sunset Sessions · Saturday",
  category: "music",
  location: "North Pier",
  description: "Golden hour sets.",
  capacity: 150,
  sold: 150,
  reserved: 0,
  priceMinor: 3000,
  currency: "EUR",
  maxPerOrder: 2,
  startsAt: new Date("2027-07-17T16:30:00Z"),
  endsAt: new Date("2027-07-17T18:30:00Z"),
  event: { id: "event", title: "Halcyon Shore", timeZone: "Europe/Bucharest", startsAt: new Date("2027-07-16T10:00:00Z"), endsAt: new Date("2027-07-18T21:00:00Z") },
  waitlistRequests: 212,
  soldOutViewers: 300,
  uniqueInterested: 384,
  liveSignals: 0,
  seedSignals: 512,
  firstSignalAt: null,
  lastSignalAt: null,
  ...overrides,
});
const now = new Date("2027-05-01T00:00:00Z");

describe("additional-session opportunity", () => {
  it("reproduces the flagship example: 384 interested, 150 places at EUR 35, EUR 5,250 maximum", () => {
    const o = proposeAdditionalSession(session(), now)!;
    expect(o.proposal).toMatchObject({ capacity: 150, priceMinor: 3500, maxGrossMinor: 525_000, startsAt: "2027-07-18T16:30:00.000Z" });
    expect(o.assumptions.scenarios).toEqual([
      { label: "low", conversionPercent: 25, tickets: 96, grossMinor: 336_000 },
      { label: "mid", conversionPercent: 50, tickets: 150, grossMinor: 525_000 },
      { label: "high", conversionPercent: 75, tickets: 150, grossMinor: 525_000 },
    ]);
    expect(o.risks.join(" ")).toMatch(/not a purchase commitment/);
    expect(o.risks.join(" ")).toMatch(/seeded/);
  });

  it("keeps the original price when interest is under twice the capacity, and sizes capacity to interest", () => {
    const o = proposeAdditionalSession(session({ uniqueInterested: 64 }), now)!;
    expect(o.proposal).toMatchObject({ capacity: 70, priceMinor: 3000 });
  });

  it("proposes nothing for sessions with places left, thin interest or no free slot", () => {
    expect(proposeAdditionalSession(session({ sold: 140 }), now)).toBeNull();
    expect(proposeAdditionalSession(session({ uniqueInterested: 30 }), now)).toBeNull();
    const lastDay = session({ startsAt: new Date("2027-07-18T16:30:00Z"), endsAt: new Date("2027-07-18T18:30:00Z") });
    expect(proposeAdditionalSession(lastDay, now)!.proposal.startsAt).toBe("2027-07-17T16:30:00.000Z");
    const oneDay = session({ event: { ...session().event, startsAt: new Date("2027-07-17T10:00:00Z"), endsAt: new Date("2027-07-17T21:00:00Z") } });
    expect(proposeAdditionalSession(oneDay, now)).toBeNull();
  });

  it("only accepts narratives whose numbers come from the analysis", () => {
    const o = proposeAdditionalSession(session(), now)!;
    const allowed = groundedNumbers(o);
    expect(ungroundedNumbers(rulesNarrative(o), allowed)).toEqual([]);
    expect(ungroundedNumbers("384 people want in; a 150-place session at EUR 35 could gross EUR 5,250.", allowed)).toEqual([]);
    expect(ungroundedNumbers("Expect 1,200 buyers and EUR 9,999.", allowed)).toEqual(["1200", "9999"]);
  });
});

describe("local-time arithmetic", () => {
  it("keeps wall-clock time across a daylight-saving change", () => {
    // Europe/Bucharest leaves summer time on 2027-10-31: 18:30 local is 15:30Z before and 16:30Z after.
    expect(shiftLocalDays(new Date("2027-10-30T15:30:00Z"), 1, "Europe/Bucharest").toISOString()).toBe("2027-10-31T16:30:00.000Z");
    expect(shiftLocalDays(new Date("2027-07-17T16:30:00Z"), -1, "Europe/Bucharest").toISOString()).toBe("2027-07-16T16:30:00.000Z");
  });
});

describe("parameter hashing", () => {
  it("is independent of key order and sensitive to every value", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe('{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}');
    expect(paramsHash({ a: 1, b: 2 })).toBe(paramsHash({ b: 2, a: 1 }));
    expect(paramsHash({ a: 1, b: 2 })).not.toBe(paramsHash({ a: 1, b: 3 }));
  });
});

describe("AI cost", () => {
  it("is integer micro-USD, rounded up", () => {
    const pricing = { inputMicroUsdPerMTok: 100_000, outputMicroUsdPerMTok: 500_000 };
    expect(costMicroUsd(pricing, { inputTokens: 3000, outputTokens: 500 })).toBe(550);
    expect(costMicroUsd(pricing, { inputTokens: 1, outputTokens: 0 })).toBe(1);
  });
});

describe("deterministic intent parsing", () => {
  const cities = ["Constanța", "Bucharest", "Cluj-Napoca"];
  const today = new Date("2027-03-10T00:00:00Z");

  it("reads category, city, month and budget", () => {
    expect(parseIntent("Jazz in Bucharest in May under €40", cities, today)).toMatchObject({ category: "concert", city: "Bucharest", month: "2027-05", maxPriceMinor: 4000 });
    expect(parseIntent("techno weekend, 60 lei max", cities, today)).toMatchObject({ category: "club", maxPriceMinor: 6000 });
  });

  it("rolls past months into next year and keeps meaningful words as terms", () => {
    const intent = parseIntent("sunset yoga by the sea in february", cities, today);
    expect(intent.month).toBe("2028-02");
    expect(intent.terms).toEqual(expect.arrayContaining(["sunset", "yoga"]));
    expect(intent.terms).not.toContain("february");
  });
});
