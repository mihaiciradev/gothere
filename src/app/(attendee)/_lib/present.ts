import { categoryLabels, formatDateRange, formatPrice, formatStamp } from "@/components/format";
import type { EventCard } from "@/modules/events";
import type { IndexRow } from "../_components/event-index";

export function toIndexRow(event: EventCard): IndexRow {
  return {
    slug: event.slug,
    title: event.title,
    category: categoryLabels[event.category]?.replace(/s$/, "") ?? event.category,
    city: event.city,
    venueName: event.venueName,
    stamp: formatStamp(event.startsAt, event.timeZone),
    dateLabel: formatDateRange(event.startsAt, event.endsAt, event.timeZone),
    priceLabel: event.fromPriceMinor !== null && event.currency ? formatPrice(event.fromPriceMinor, event.currency) : null,
    availability: event.availability,
    heroImageUrl: event.heroImageUrl,
    experienceCount: event.experienceCount,
  };
}

/** The homepage leads with the richest upcoming programme: most experiences, then soonest. */
export function pickFeatured(events: EventCard[]): EventCard | undefined {
  return [...events]
    .filter((e) => e.heroImageUrl && e.availability !== "not_on_sale")
    .sort((a, b) => b.experienceCount - a.experienceCount || a.startsAt.getTime() - b.startsAt.getTime())[0];
}

/** Splits a display title into balanced lines for the reveal animation. */
export function titleLines(title: string): string[] {
  const words = title.split(" ");
  if (words.length <= 2) return words.length === 2 && title.length > 14 ? words : [title];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}
