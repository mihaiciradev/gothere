export type AvailabilityStatus = "available" | "limited" | "sold_out" | "not_on_sale";

/** Coarse, public availability signal. "limited" when 10% or less of sellable capacity remains. */
export function availabilityStatus(available: number, capacity: number): AvailabilityStatus {
  if (capacity <= 0) return "not_on_sale";
  if (available <= 0) return "sold_out";
  if (available / capacity <= 0.1) return "limited";
  return "available";
}
