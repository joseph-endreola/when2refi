/**
 * Domain types for when2refi DSC math.
 *
 * Storage representations (MATH.md §1):
 *   - Cents       — monetary values, integer
 *   - BasisPoints — interest/return rates, integer (6.75% = 675)
 *   - Months      — integer counts of months
 *
 * Working representations (used inside math modules):
 *   - Dollars     — monetary values as plain numbers
 *   - DecimalRate — annual rates as decimals (0.0675 = 6.75%)
 *   - MonthlyRate — DecimalRate / 12
 *
 * Boundary functions convert between storage and working forms. Smart
 * constructors validate inputs at the storage boundary. Arithmetic inside
 * math modules happens on plain numbers (Dollars, DecimalRate, etc) so
 * formulas read naturally; results are re-branded at exit.
 *
 * Branding: phantom-property pattern. The brand symbol is module-private,
 * so values can only be produced through the constructors in this file.
 */

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

// ---------------------------------------------------------------------------
// Storage types — match D1 schema column types
// ---------------------------------------------------------------------------

export type Cents = Brand<number, 'Cents'>;
export type BasisPoints = Brand<number, 'BasisPoints'>;
export type Months = Brand<number, 'Months'>;

// ---------------------------------------------------------------------------
// Working types — used inside math computations
// ---------------------------------------------------------------------------

export type Dollars = Brand<number, 'Dollars'>;
export type DecimalRate = Brand<number, 'DecimalRate'>;
export type MonthlyRate = Brand<number, 'MonthlyRate'>;

// ---------------------------------------------------------------------------
// Smart constructors — total parsers from raw number into branded type.
// Throw RangeError on invalid input (parse, do not validate).
// ---------------------------------------------------------------------------

const requireFinite = (n: number, label: string): void => {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new RangeError(`${label} must be a finite number, got ${String(n)}`);
  }
};

const requireInteger = (n: number, label: string): void => {
  requireFinite(n, label);
  if (!Number.isInteger(n)) {
    throw new RangeError(`${label} must be an integer, got ${n}`);
  }
};

const requireNonNegative = (n: number, label: string): void => {
  requireFinite(n, label);
  if (n < 0) {
    throw new RangeError(`${label} must be >= 0, got ${n}`);
  }
};

/** Construct Cents from an integer value. Negative cents allowed (deltas). */
export const cents = (n: number): Cents => {
  requireInteger(n, 'cents');
  return n as Cents;
};

/** Construct BasisPoints from an integer. Negative allowed (rate deltas). */
export const bps = (n: number): BasisPoints => {
  requireInteger(n, 'bps');
  return n as BasisPoints;
};

/** Construct Months from a non-negative integer. */
export const months = (n: number): Months => {
  requireInteger(n, 'months');
  requireNonNegative(n, 'months');
  return n as Months;
};

/** Construct Dollars from any finite number. */
export const dollars = (n: number): Dollars => {
  requireFinite(n, 'dollars');
  return n as Dollars;
};

/** Construct a DecimalRate (annual) from any finite number. */
export const decimalRate = (n: number): DecimalRate => {
  requireFinite(n, 'decimalRate');
  return n as DecimalRate;
};

/** Construct a MonthlyRate from any finite number. */
export const monthlyRate = (n: number): MonthlyRate => {
  requireFinite(n, 'monthlyRate');
  return n as MonthlyRate;
};

// ---------------------------------------------------------------------------
// Boundary conversions — Cents <-> Dollars, BasisPoints <-> DecimalRate.
// These are the only sanctioned bridges between storage and working forms.
// ---------------------------------------------------------------------------

/** Cents → Dollars (no rounding; division is exact in IEEE 754 for integer/100). */
export const centsToDollars = (c: Cents): Dollars =>
  ((c as number) / 100) as Dollars;

/** Dollars → Cents (rounds to nearest cent). */
export const dollarsToCents = (d: Dollars): Cents => {
  const rounded = Math.round((d as number) * 100);
  return cents(rounded);
};

/** BasisPoints → DecimalRate (annual). 675 → 0.0675 */
export const bpsToDecimalRate = (b: BasisPoints): DecimalRate =>
  ((b as number) / 10000) as DecimalRate;

/** DecimalRate (annual) → BasisPoints (rounded). 0.0675 → 675 */
export const decimalRateToBps = (r: DecimalRate): BasisPoints => {
  const rounded = Math.round((r as number) * 10000);
  return bps(rounded);
};

/** DecimalRate (annual) → MonthlyRate. */
export const annualToMonthly = (r: DecimalRate): MonthlyRate =>
  ((r as number) / 12) as MonthlyRate;

/** MonthlyRate → DecimalRate (annual). */
export const monthlyToAnnual = (r: MonthlyRate): DecimalRate =>
  ((r as number) * 12) as DecimalRate;

// ---------------------------------------------------------------------------
// Unwrappers — explicit, for use only at module boundaries (e.g. when handing
// values to display layers or external APIs). Math modules generally arithmetic
// on the raw number value implicitly via TS structural compatibility.
// ---------------------------------------------------------------------------

export const unwrapCents = (c: Cents): number => c as number;
export const unwrapBps = (b: BasisPoints): number => b as number;
export const unwrapMonths = (m: Months): number => m as number;
export const unwrapDollars = (d: Dollars): number => d as number;
export const unwrapDecimalRate = (r: DecimalRate): number => r as number;
export const unwrapMonthlyRate = (r: MonthlyRate): number => r as number;
