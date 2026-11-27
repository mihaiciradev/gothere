import { AppError } from "./errors";

export const currencies = ["EUR", "RON"] as const;
export type Currency = (typeof currencies)[number];

/** Amounts are integer minor units (cents/bani). Never floats. */
export type Money = Readonly<{ amountMinor: number; currency: Currency }>;

const minorDigits: Record<Currency, number> = { EUR: 2, RON: 2 };

function assertMinor(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new AppError("VALIDATION_FAILED", "Monetary amounts must be safe integers in minor units.");
  }
}

export function money(amountMinor: number, currency: Currency): Money {
  assertMinor(amountMinor);
  return { amountMinor, currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new AppError("VALIDATION_FAILED", "Cannot add amounts in different currencies.");
  }
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function multiplyMoney(a: Money, quantity: number): Money {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new AppError("VALIDATION_FAILED", "Quantity must be a non-negative integer.");
  }
  return money(a.amountMinor * quantity, a.currency);
}

export function sumMoney(items: readonly Money[], currency: Currency): Money {
  return items.reduce<Money>((total, item) => addMoney(total, item), money(0, currency));
}

export function formatMoney(value: Money, locale = "en-IE"): string {
  const digits = minorDigits[value.currency];
  const major = value.amountMinor / 10 ** digits;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: value.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(major);
}
