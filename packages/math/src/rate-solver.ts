// Rate solver for MATH.md §4.
//
// Given a balance B, term n, and target P&I payment P_target, find the
// monthly rate r_m such that P(B, r_m, n) = P_target. Bisection over
// [0.01% annual, 20% annual] with a §4.1 feasibility check at the boundary.
//
// Returns a discriminated union so callers must handle all four §4 cases.
// Domain failures (infeasible at zero rate, requires extreme rate) are
// values, not exceptions. The only thrown error is for invalid input.

import type { Dollars, MonthlyRate } from './units';
import type { Months } from './amortization';
import { monthlyPayment } from './amortization.js';

// §4.2 algorithm tuning. Constants per the spec, not exported.
const RATE_FLOOR_MONTHLY: MonthlyRate = 0.0001 / 12; // 0.01% annual
const RATE_CEILING_MONTHLY: MonthlyRate = 0.2 / 12;  // 20% annual
const MAX_ITERATIONS = 100;
const CONVERGENCE_TOLERANCE = 1e-10;                 // monthly-rate units

/**
 * Outcome of solveForRate. Discriminated union covering all four cases of
 * MATH.md §4. Each kind has a documented display message in the JSDoc.
 */
export type RateSolverResult =
  /**
   * §4.1. P_target < B/n. Even at 0% interest, retiring this balance in
   * n months requires a higher payment than the target. paymentFloor is B/n.
   *
   * Display: "Even at 0% interest, retiring this balance in [n] months
   * requires $[paymentFloor]/mo."
   */
  | { kind: 'infeasible_zero_rate'; paymentFloor: Dollars }
  /**
   * §4.2. P(r_lo, B, n) >= P_target. Target is achievable at or below the
   * 0.01%-annual rate floor. Any realistic rate works.
   *
   * Display: "achievable at any realistic rate".
   */
  | { kind: 'trivially_achievable' }
  /**
   * §4.2. P(r_hi, B, n) < P_target. Achieving the target would require
   * a rate above the 20%-annual ceiling.
   *
   * Display: "requires rates above 20% — goal not achievable as stated".
   */
  | { kind: 'requires_extreme_rate' }
  /**
   * §4.2 main. Bisection converged. monthlyRate is the solved value
   * (decimal monthly). iterations is the number of bisection steps
   * performed, capped at MAX_ITERATIONS.
   */
  | { kind: 'solved'; monthlyRate: MonthlyRate; iterations: number };

/**
 * Solve for the monthly rate that produces a target P&I payment for a
 * given balance and term.
 *
 * MATH.md §4. Combines §4.1 feasibility with §4.2 bisection.
 *
 * Bisection bounds and convergence parameters are fixed per the spec:
 *
 *   rate floor:      0.01% annual  (effectively zero, sentinel for the
 *                                   trivially-achievable case)
 *   rate ceiling:    20% annual
 *   max iterations:  100
 *   tolerance:       1e-10 (monthly-rate units)
 *
 * Returns a discriminated union covering all four §4 cases. No exceptions
 * are thrown for domain failures; the infeasible outcomes are values.
 * The only thrown error is for invalid input (non-positive term).
 */
export function solveForRate(
  balance: Dollars,
  termMonths: Months,
  targetPayment: Dollars,
): RateSolverResult {
  if (termMonths <= 0) {
    throw new Error('solveForRate: termMonths must be positive');
  }

  // §4.1 feasibility check.
  const paymentFloor: Dollars = balance / termMonths;
  if (targetPayment < paymentFloor) {
    return { kind: 'infeasible_zero_rate', paymentFloor };
  }

  // §4.2 boundary checks.
  const paymentAtFloor = monthlyPayment(
    balance,
    RATE_FLOOR_MONTHLY,
    termMonths,
  );
  if (paymentAtFloor >= targetPayment) {
    return { kind: 'trivially_achievable' };
  }
  const paymentAtCeiling = monthlyPayment(
    balance,
    RATE_CEILING_MONTHLY,
    termMonths,
  );
  if (paymentAtCeiling < targetPayment) {
    return { kind: 'requires_extreme_rate' };
  }

  // §4.2 bisection. Target falls strictly between boundary payments;
  // monthlyPayment is monotonic increasing in rate so bisection converges.
  let lo: MonthlyRate = RATE_FLOOR_MONTHLY;
  let hi: MonthlyRate = RATE_CEILING_MONTHLY;
  let iterations = 0;
  while (iterations < MAX_ITERATIONS) {
    const mid = (lo + hi) / 2;
    const paymentAtMid = monthlyPayment(balance, mid, termMonths);
    if (paymentAtMid > targetPayment) {
      hi = mid;
    } else {
      lo = mid;
    }
    iterations++;
    if (hi - lo < CONVERGENCE_TOLERANCE) {
      break;
    }
  }

  return {
    kind: 'solved',
    monthlyRate: (lo + hi) / 2,
    iterations,
  };
}
