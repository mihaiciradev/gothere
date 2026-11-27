import { shiftLocalDays } from "./local-time";

/** Facts about one sold-out experience session, all read from the database. */
export type SessionDemand = {
  inventoryItemId: string;
  experienceId: string;
  experienceSlug: string;
  experienceTitle: string;
  itemName: string;
  category: string;
  location: string | null;
  description: string;
  capacity: number;
  sold: number;
  reserved: number;
  priceMinor: number;
  currency: string;
  maxPerOrder: number;
  startsAt: Date;
  endsAt: Date;
  event: { id: string; title: string; timeZone: string; startsAt: Date; endsAt: Date };
  waitlistRequests: number;
  soldOutViewers: number;
  uniqueInterested: number;
  liveSignals: number;
  seedSignals: number;
  firstSignalAt: Date | null;
  lastSignalAt: Date | null;
};

export type Evidence = {
  itemName: string;
  capacity: number;
  sold: number;
  available: number;
  sellThroughPercent: number;
  waitlistRequests: number;
  soldOutViewers: number;
  uniqueInterested: number;
  interestToCapacityRatio: number;
  liveSignals: number;
  seedSignals: number;
  firstSignalAt: string | null;
  lastSignalAt: string | null;
  priceMinor: number;
  currency: string;
};

export type Proposal = {
  title: string;
  slug: string;
  description: string;
  category: string;
  location: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  priceMinor: number;
  currency: "EUR" | "RON";
  maxPerOrder: number;
  maxGrossMinor: number;
};

export type ConversionScenario = { label: "low" | "mid" | "high"; conversionPercent: number; tickets: number; grossMinor: number };

export type Assumptions = {
  basis: string;
  scenarios: ConversionScenario[];
  priceRule: string;
  capacityRule: string;
  timingRule: string;
};

export type Opportunity = {
  kind: "additional_session";
  inventoryItemId: string;
  evidence: Evidence;
  proposal: Proposal;
  assumptions: Assumptions;
  risks: string[];
};

/** Thresholds are deliberately conservative: a recommendation should survive a sceptical organiser. */
export const OPPORTUNITY_RULES = {
  minUniqueInterested: 20,
  minInterestShareOfCapacity: 0.25,
  premiumAtRatio: 2,
  premiumPercent: 15,
  conversionPercents: { low: 25, mid: 50, high: 75 },
} as const;

const supportedCurrencies = new Set(["EUR", "RON"]);

function roundPrice(minor: number): number {
  const step = minor >= 2000 ? 500 : 100;
  return Math.round(minor / step) * step;
}

/** Same local time on the next day if it fits inside the event, otherwise the previous day; never in the past. */
function proposeSlot(s: SessionDemand, now: Date): { startsAt: Date; endsAt: Date; rule: string } | null {
  for (const days of [1, -1]) {
    const startsAt = shiftLocalDays(s.startsAt, days, s.event.timeZone);
    const endsAt = shiftLocalDays(s.endsAt, days, s.event.timeZone);
    if (startsAt >= s.event.startsAt && endsAt <= s.event.endsAt && startsAt > now) {
      return { startsAt, endsAt, rule: `Same local start time ${days === 1 ? "the following" : "the previous"} day, inside the event.` };
    }
  }
  return null;
}

const percent = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

/**
 * Turns unmet demand for a sold-out session into a second-session proposal, or returns null when the evidence is
 * too thin, the session is not sold out, or no slot fits. Pure: identical inputs always give identical output.
 */
export function proposeAdditionalSession(s: SessionDemand, now: Date): Opportunity | null {
  const available = s.capacity - s.sold - s.reserved;
  if (s.capacity <= 0 || available > 0) return null;
  if (!supportedCurrencies.has(s.currency)) return null;
  const threshold = Math.max(OPPORTUNITY_RULES.minUniqueInterested, Math.ceil(s.capacity * OPPORTUNITY_RULES.minInterestShareOfCapacity));
  if (s.uniqueInterested < threshold) return null;
  const slot = proposeSlot(s, now);
  if (!slot) return null;

  const capacity = Math.min(s.capacity, Math.ceil(s.uniqueInterested / 10) * 10);
  const ratio = s.uniqueInterested / capacity;
  const premium = ratio >= OPPORTUNITY_RULES.premiumAtRatio;
  const priceMinor = premium ? roundPrice(Math.round(s.priceMinor * (1 + OPPORTUNITY_RULES.premiumPercent / 100))) : s.priceMinor;

  const scenarios = (Object.entries(OPPORTUNITY_RULES.conversionPercents) as [ConversionScenario["label"], number][]).map(
    ([label, conversionPercent]) => {
      const tickets = Math.min(capacity, Math.floor((s.uniqueInterested * conversionPercent) / 100));
      return { label, conversionPercent, tickets, grossMinor: tickets * priceMinor };
    },
  );

  const risks = [
    "Interest is not a purchase commitment; sold-out page views include visitors who may never buy.",
    "A second session can draw buyers away from other experiences at the event.",
    "Crew, venue and safety staffing for the proposed slot must be confirmed before publishing.",
    "Revenue figures are gross estimates before fees and operating costs.",
  ];
  if (premium) risks.push(`The proposed price is ${OPPORTUNITY_RULES.premiumPercent}% above the original session; demand may be price-sensitive.`);
  if (s.seedSignals > 0) risks.push("Part of the demand history is seeded demonstration data, not live activity.");

  return {
    kind: "additional_session",
    inventoryItemId: s.inventoryItemId,
    evidence: {
      itemName: s.itemName,
      capacity: s.capacity,
      sold: s.sold,
      available,
      sellThroughPercent: percent(s.sold, s.capacity),
      waitlistRequests: s.waitlistRequests,
      soldOutViewers: s.soldOutViewers,
      uniqueInterested: s.uniqueInterested,
      interestToCapacityRatio: Math.round(ratio * 100) / 100,
      liveSignals: s.liveSignals,
      seedSignals: s.seedSignals,
      firstSignalAt: s.firstSignalAt?.toISOString() ?? null,
      lastSignalAt: s.lastSignalAt?.toISOString() ?? null,
      priceMinor: s.priceMinor,
      currency: s.currency,
    },
    proposal: {
      title: `${s.experienceTitle} · Second session`,
      slug: `${s.experienceSlug}-second-session`.slice(0, 80).replace(/-+$/, ""),
      description: s.description,
      category: s.category,
      location: s.location,
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      capacity,
      priceMinor,
      currency: s.currency as "EUR" | "RON",
      maxPerOrder: s.maxPerOrder,
      maxGrossMinor: capacity * priceMinor,
    },
    assumptions: {
      basis: `Unique interested attendees (${s.uniqueInterested}) = distinct people who joined the waitlist or viewed the sold-out session.`,
      scenarios,
      priceRule: premium
        ? `Interest is at least ${OPPORTUNITY_RULES.premiumAtRatio}× the proposed capacity, so the price is ${OPPORTUNITY_RULES.premiumPercent}% above the original, rounded.`
        : "Interest is below twice the proposed capacity, so the original price is kept.",
      capacityRule: "Original session capacity, reduced to the interest level (rounded up to 10) when interest is lower.",
      timingRule: slot.rule,
    },
    risks,
  };
}

const formatMoney = (minor: number, currency: string) => `${currency} ${(minor / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;

/** The deterministic narrative used when no model is available or the model's text fails the grounding check. */
export function rulesNarrative(o: Opportunity): string {
  const e = o.evidence;
  const p = o.proposal;
  const low = o.assumptions.scenarios[0]!;
  return [
    `${e.itemName} sold all ${e.capacity} places. ${e.uniqueInterested} unique attendees still want in: ${e.waitlistRequests} joined the waitlist and ${e.soldOutViewers} viewed the sold-out session.`,
    `A second session of ${p.capacity} places at ${formatMoney(p.priceMinor, p.currency)} could gross at most ${formatMoney(p.maxGrossMinor, p.currency)}.`,
    `If only ${low.conversionPercent}% of interested attendees buy, that is ${low.tickets} tickets and ${formatMoney(low.grossMinor, p.currency)}. These are estimates, not a forecast of sales.`,
  ].join(" ");
}

/** Every number a narrative may cite: evidence, proposal and assumptions in minor and major units. */
export function groundedNumbers(o: Opportunity): Set<string> {
  const values = new Set<number>();
  const add = (n: number) => {
    values.add(n);
  };
  const addMoney = (minor: number) => {
    add(minor);
    add(minor / 100);
  };
  const e = o.evidence;
  [e.capacity, e.sold, e.available, e.sellThroughPercent, e.waitlistRequests, e.soldOutViewers, e.uniqueInterested, e.interestToCapacityRatio].forEach(add);
  addMoney(e.priceMinor);
  add(o.proposal.capacity);
  addMoney(o.proposal.priceMinor);
  addMoney(o.proposal.maxGrossMinor);
  add(OPPORTUNITY_RULES.premiumPercent);
  add(OPPORTUNITY_RULES.premiumAtRatio);
  for (const s of o.assumptions.scenarios) {
    add(s.conversionPercent);
    add(s.tickets);
    addMoney(s.grossMinor);
  }
  for (let i = 0; i <= 10; i++) add(i);
  return new Set([...values].map((v) => String(Number(v.toFixed(2)))));
}

/** Numbers that appear in `text` but not in `allowed`. Thousands separators and trailing zeros are normalised. */
export function ungroundedNumbers(text: string, allowed: Set<string>): string[] {
  const found = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return found
    .map((raw) => String(Number(raw.replace(/,/g, ""))))
    .filter((n) => n !== "NaN" && !allowed.has(n));
}
