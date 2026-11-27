import { type Currency, formatMoney, money } from "@/shared/money";

/** Presentation helpers. Dates are always rendered in the event's own time zone, never the viewer's. */

const LOCALE = "en-GB";

/** Whole amounts drop the decimals (€89); others keep them (€89.50). */
export function formatPrice(amountMinor: number, currency: string): string {
  const formatted = formatMoney(money(amountMinor, currency as Currency), "en-IE");
  return amountMinor % 100 === 0 ? formatted.replace(/[.,]00(?=\D*$)/, "") : formatted;
}

export function formatDateRange(startsAt: Date, endsAt: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat(LOCALE, { day: "numeric", timeZone });
  const dayMonth = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone });
  const full = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone });
  const sameMonth = new Intl.DateTimeFormat(LOCALE, { month: "numeric", year: "numeric", timeZone });
  // The last night of a festival ends after midnight; display the day it belongs to.
  const displayEnd = new Date(endsAt.getTime() - 6 * 60 * 60 * 1000);
  if (full.format(startsAt) === full.format(displayEnd) || displayEnd <= startsAt) return full.format(startsAt);
  if (sameMonth.format(startsAt) === sameMonth.format(displayEnd)) return `${day.format(startsAt)}–${full.format(displayEnd)}`;
  return `${dayMonth.format(startsAt)} – ${full.format(displayEnd)}`;
}

export function formatDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short", timeZone }).format(date);
}

export function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(date);
}

export function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year!, m! - 1, 1)));
}

/** Short stamp for the editorial index: "09 JUL". */
export function formatStamp(date: Date, timeZone: string): { day: string; month: string; year: string } {
  const parts = new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "short", year: "numeric", timeZone }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: get("day"), month: get("month").toUpperCase(), year: get("year") };
}

export const categoryLabels: Record<string, string> = {
  festival: "Festivals",
  concert: "Concerts",
  club: "Club nights",
  culture: "Culture",
  music: "Music",
  wellness: "Wellness",
  talk: "Talks",
  food: "Food",
  outdoors: "Outdoors",
  workshop: "Workshops",
};
