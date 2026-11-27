/** Offset of `timeZone` from UTC at `instant`, in minutes (e.g. +180 for Europe/Bucharest in summer). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * The instant with the same local wall-clock time `days` later in `timeZone`. Adding 24 h in UTC would shift the
 * local time by an hour across a daylight-saving change; this keeps "18:30 on Sunday" at 18:30.
 */
export function shiftLocalDays(instant: Date, days: number, timeZone: string): Date {
  const naive = new Date(instant.getTime() + days * 86_400_000);
  const correction = offsetMinutes(instant, timeZone) - offsetMinutes(naive, timeZone);
  return new Date(naive.getTime() + correction * 60_000);
}
