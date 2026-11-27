/** Deterministic reading of an attendee request, used when no model is available. Pure and unit-tested. */

export type ParsedIntent = {
  category?: "festival" | "concert" | "club" | "culture";
  city?: string;
  month?: string;
  maxPriceMinor?: number;
  terms: string[];
};

const categoryWords: [ParsedIntent["category"], RegExp][] = [
  ["club", /\b(club|clubbing|techno|house|dj|rave|electronic|dance|party)\b/],
  ["concert", /\b(concert|gig|jazz|band|orchestra|live music|trio|quartet)\b/],
  ["culture", /\b(culture|art|arts|exhibition|light|lights|installation|theatre|theater|museum)\b/],
  ["festival", /\b(festival|festivals|fest|weekender|open air|camping)\b/],
];

const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const stopwords = new Set(
  "a an and any are around at be best book can cheap cheaper find for from get give good have i im in is it looking me month my near need next of on or please show some something that the there this to under up want we weekend what where which with would you your euro euros eur lei ron price budget less than below max maximum tickets ticket event events go going".split(
    " ",
  ),
);

function parseMonth(text: string, now: Date): string | undefined {
  const match = text.match(new RegExp(`\\b(${months.join("|")}|${months.map((m) => m.slice(0, 3)).join("|")})\\b(?:\\s+(\\d{4}))?`));
  if (!match) return undefined;
  const index = months.findIndex((m) => m.startsWith(match[1]!.slice(0, 3)));
  let year = match[2] ? Number(match[2]) : now.getUTCFullYear();
  if (!match[2] && index < now.getUTCMonth()) year += 1;
  return `${year}-${String(index + 1).padStart(2, "0")}`;
}

function parseBudget(text: string): number | undefined {
  const patterns = [
    /(?:under|below|less than|max(?:imum)?|up to|within|budget(?: of)?)\s*(?:€|eur(?:o|os)?\s*)?(\d{1,5})/,
    /€\s*(\d{1,5})/,
    /(\d{1,5})\s*(?:€|eur|euro|euros|lei|ron)\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]) * 100;
  }
  return undefined;
}

export function parseIntent(message: string, cities: readonly string[], now: Date): ParsedIntent {
  const text = message.toLowerCase().normalize("NFKC");
  const intent: ParsedIntent = { terms: [] };
  for (const [category, pattern] of categoryWords) {
    if (pattern.test(text)) {
      intent.category = category;
      break;
    }
  }
  intent.city = cities.find((city) => new RegExp(`\\b${city.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
  intent.month = parseMonth(text, now);
  intent.maxPriceMinor = parseBudget(text);

  const consumed = new Set([...(intent.city?.toLowerCase().split(/\s+/) ?? []), ...months, ...months.map((m) => m.slice(0, 3))]);
  intent.terms = [
    ...new Set(
      text
        .replace(/[^\p{L}\s-]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !stopwords.has(w) && !consumed.has(w)),
    ),
  ].slice(0, 5);
  return intent;
}
