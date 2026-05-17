/**
 * @when2refi/math
 *
 * Pure functional core for the Decision Support Calculator. All formulas
 * derive from MATH.md. No I/O, no time, no randomness — every function is
 * deterministic and referentially transparent.
 *
 * Implementation modules will be added incrementally:
 *   - amortization (MATH.md §2)
 *   - closing costs (MATH.md §3)
 *   - solver (MATH.md §4)
 *   - goals (MATH.md §5.x)
 *   - investment (MATH.md §6)
 *   - hold-sell (MATH.md §7)
 *
 * Public surface: re-exports are explicit named exports; the public API is
 * curated, not wildcard-derived.
 */

export * from './types.js';

export {
  cents,
  bps,
  centsToDollars,
  dollarsToCents,
  bpsToAnnualRate,
  annualRateToBps,
  bpsToMonthlyRate,
  monthlyRateToBps,
} from './units.js';
export type {
  Dollars,
  MonthlyRate,
  AnnualRate,
  Cents,
  Bps,
} from './units.js';

export {
  monthlyPayment,
  monthsBetween,
  remainingTerm,
  remainingInterest,
  balanceAtMonth,
  annualInterest,
} from './amortization.js';
export type {
  Months,
  RemainingTerm,
} from './amortization.js';
