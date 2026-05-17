// Storage ↔ working unit boundary for MATH.md §1.
//
// Storage formats are branded so they cannot be accidentally passed where a
// working unit is expected:
//
//   INTEGER cents (D1)        ↔ Dollars (number)
//   INTEGER basis points (D1) ↔ decimal annual rate (number)
//                                or decimal monthly rate (number)
//
// All storage ↔ working conversions happen here. No other module is allowed
// to divide a *_cents column by 100 or a *_bps column by 10000 inline.

// ---------- Working-unit type aliases ----------

/** Dollars, working unit. */
export type Dollars = number;

/** Monthly interest rate, decimal. annual_bps / 10000 / 12. */
export type MonthlyRate = number;

/** Annual interest rate, decimal. annual_bps / 10000. */
export type AnnualRate = number;

// ---------- Branded storage types ----------

declare const __cents: unique symbol;
declare const __bps: unique symbol;

/** Integer cents, as stored in D1. $6.75 = 675. */
export type Cents = number & { readonly [__cents]: 'Cents' };

/** Integer basis points, as stored in D1. 6.75% = 675. */
export type Bps = number & { readonly [__bps]: 'Bps' };

/**
 * Construct a Cents value from a raw integer.
 * Use at the storage boundary: when a `*_cents` column is read from D1, wrap
 * it once with `cents(...)` and pass the branded value forward.
 */
export const cents = (n: number): Cents => {
  if (!Number.isInteger(n)) {
    throw new Error(`cents: expected integer, got ${n}`);
  }
  return n as Cents;
};

/**
 * Construct a Bps value from a raw integer.
 * Use at the storage boundary: when a `*_bps` column is read from D1, wrap
 * it once with `bps(...)` and pass the branded value forward.
 */
export const bps = (n: number): Bps => {
  if (!Number.isInteger(n)) {
    throw new Error(`bps: expected integer, got ${n}`);
  }
  return n as Bps;
};

// ---------- Cents ↔ Dollars ----------

/** Cents → Dollars. Storage to working unit. 32_500_000 → 325000. */
export function centsToDollars(c: Cents): Dollars {
  return (c as number) / 100;
}

/**
 * Dollars → Cents. Working unit to storage. Rounds to the nearest integer
 * cent — never writes a fractional cent to D1. 325000 → 32_500_000.
 */
export function dollarsToCents(d: Dollars): Cents {
  return Math.round(d * 100) as Cents;
}

// ---------- Bps ↔ rate ----------

/** Bps → decimal annual rate. 675 → 0.0675. */
export function bpsToAnnualRate(b: Bps): AnnualRate {
  return (b as number) / 10000;
}

/**
 * Decimal annual rate → Bps. Rounds to the nearest integer bp.
 * 0.0675 → 675.
 */
export function annualRateToBps(r: AnnualRate): Bps {
  return Math.round(r * 10000) as Bps;
}

/**
 * Bps → decimal monthly rate. Annual bps divided by 10000 then by 12.
 * 675 (annual bps) → 0.005625 (monthly decimal).
 */
export function bpsToMonthlyRate(b: Bps): MonthlyRate {
  return (b as number) / 10000 / 12;
}

/**
 * Decimal monthly rate → Bps (annual). Convenience inverse for solver output:
 * the rate solver works in monthly decimal, but the product query and the
 * `interest_rate_bps` column store annual bps.
 *
 * Multiplies by 12 to annualize, then by 10000 to convert to basis points,
 * then rounds to the nearest integer bp.
 */
export function monthlyRateToBps(m: MonthlyRate): Bps {
  return Math.round(m * 12 * 10000) as Bps;
}
