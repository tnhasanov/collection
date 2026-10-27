import Decimal from "decimal.js";

// Calculation precision is deliberately higher than display precision; money is rounded only at
// defined points (per installment component, per allocation) using half-up rounding to AZN cents.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type DecimalLike = Decimal.Value | { toString(): string };

export const ZERO = new Decimal(0);
export const MONEY_SCALE = 2;

export function dec(value: DecimalLike | null | undefined): Decimal {
  if (value === null || value === undefined) return new Decimal(0);
  if (value instanceof Decimal) return value;
  if (typeof value === "number" || typeof value === "string") return new Decimal(value);
  return new Decimal(value.toString());
}

/** Round to AZN cents, half-up. */
export function money(value: DecimalLike | null | undefined): Decimal {
  return dec(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

export function sum(values: Iterable<DecimalLike | null | undefined>): Decimal {
  let total = ZERO;
  for (const v of values) total = total.plus(dec(v));
  return total;
}

export function max(a: DecimalLike, b: DecimalLike): Decimal {
  const da = dec(a);
  const db = dec(b);
  return da.greaterThanOrEqualTo(db) ? da : db;
}

export function min(a: DecimalLike, b: DecimalLike): Decimal {
  const da = dec(a);
  const db = dec(b);
  return da.lessThanOrEqualTo(db) ? da : db;
}

/** String form for persisting into Prisma Decimal columns (fixed 2 decimals). */
export function toDbMoney(value: DecimalLike | null | undefined): string {
  return money(value).toFixed(MONEY_SCALE);
}

/** String form for probabilities / rates (6 decimals). */
export function toDbRate(value: DecimalLike | null | undefined): string {
  return dec(value).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
}

const aznFormatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Centralized AZN display formatting: 4,200.00 AZN. */
export function formatAzn(value: DecimalLike | null | undefined, opts: { withCurrency?: boolean } = {}): string {
  const n = money(value);
  const text = aznFormatter.format(Number(n.toFixed(2)));
  return opts.withCurrency === false ? text : `${text} AZN`;
}

export function formatPercent(value: DecimalLike | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "n/a";
  return `${dec(value).times(100).toFixed(digits)}%`;
}

export { Decimal };
