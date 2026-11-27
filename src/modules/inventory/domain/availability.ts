export type Counters = Readonly<{ capacity: number; reserved: number; sold: number; overdueHeld: number }>;

/** Units a new buyer could reserve now. Overdue holds count as free; never exceeds capacity − sold. */
export function availableUnits(c: Counters): number {
  const held = Math.max(c.reserved - c.overdueHeld, 0);
  return Math.max(c.capacity - c.sold - held, 0);
}
