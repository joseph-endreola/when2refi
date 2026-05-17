// Goal solvers for MATH.md §5.1 through §5.4. Each solver takes current
// loan facts plus goal-specific parameters and returns the §4 rate solver
// result alongside pre-computed display values for the DSC right panel.
//
// Display values are computed from inputs alone and do not depend on the
// solved rate, so they are always present regardless of the rate solver
// outcome. The UI matches on rateSolverResult.kind to decide how to render
// the rate slot (solved rate, "achievable at any realistic rate", etc.).
//
// Goal types in this module:
//
//   §5.1 payment_reduction   reduce monthly P&I by a target amount
//   §5.2 break_even          recover closing costs within a target window
//   §5.3 total_interest      reduce total interest paid by a target amount
//   §5.4 term_shortening     pay off in target years at current payment
//
// Cash-out (§5.5) and tax optimization (§5.6) live in separate modules.

import type { Dollars } from './units';
import type { Months } from './amortization';
import { remainingInterest } from './amortization.js';
import {
  DEFAULT_CLOSING_COST_RATIO,
  closingCostEstimate,
} from './closing-costs.js';
import type { RateSolverResult } from './rate-solver';
import { solveForRate } from './rate-solver.js';

// ---------- Shared types: rate-and-term refis (§5.1, §5.2, §5.3) ----------

/**
 * Context shared by the rate-and-term refi solvers (§5.1, §5.2, §5.3).
 */
export interface RateTermRefiContext {
  /** Current loan balance. */
  readonly balance: Dollars;
  /** Current P&I payment, excluding taxes and insurance. */
  readonly currentMonthlyPayment: Dollars;
  /** Remaining months on the current loan. From remainingTerm(). */
  readonly monthsRemaining: Months;
  /** New term being modeled. UI default 360; common options 360, 240, 180. */
  readonly newTermMonths: Months;
  /**
   * Closing cost ratio. Defaults to DEFAULT_CLOSING_COST_RATIO (2.5%).
   * UI-adjustable per MATH.md §3.
   */
  readonly closingCostRatio?: number;
}

/**
 * Display values shared by the rate-and-term refi solvers. Always present
 * regardless of the rate solver outcome.
 */
export interface RateTermRefiDisplay {
  /** Closing cost estimate (B * ratio). MATH.md §3. */
  readonly closingCost: Dollars;
  /** Target P&I payment after refi. Input to the rate solver. */
  readonly targetPayment: Dollars;
  /** Remaining interest on the current loan: P_current * n_remaining - B. */
  readonly remainingInterestCurrent: Dollars;
  /** Remaining interest on the new loan at target payment over new term. */
  readonly remainingInterestNew: Dollars;
  /**
   * RI_current - RI_new. Positive means savings. Negative means the
   * term-reset penalty pushes total interest higher despite the lower rate.
   */
  readonly totalInterestDelta: Dollars;
  /**
   * True when newTermMonths > monthsRemaining. UI uses this to surface
   * the term-reset warning called out in MATH.md §5.1.
   */
  readonly isTermReset: boolean;
}

// ---------- §5.1 Payment Reduction ----------

export interface PaymentReductionParams {
  /** Target reduction in monthly P&I, in dollars. Must be positive. */
  readonly targetReduction: Dollars;
}

export interface PaymentReductionDisplay extends RateTermRefiDisplay {
  /** Monthly savings (equals targetReduction). */
  readonly monthlySavings: Dollars;
  /** Closing cost recovery time: CC / monthlySavings. */
  readonly breakEvenMonths: number;
}

export interface PaymentReductionResult {
  readonly rateSolverResult: RateSolverResult;
  readonly display: PaymentReductionDisplay;
}

/**
 * §5.1. Solve for the rate that reduces monthly P&I by targetReduction
 * dollars on a rate-and-term refi.
 *
 *   P_target = P_current - targetReduction
 *   B_new    = B
 *   n_new    = newTermMonths
 *
 * Throws on non-positive targetReduction.
 */
export function solvePaymentReduction(
  ctx: RateTermRefiContext,
  params: PaymentReductionParams,
): PaymentReductionResult {
  if (params.targetReduction <= 0) {
    throw new Error(
      'solvePaymentReduction: targetReduction must be positive',
    );
  }
  const ratio = ctx.closingCostRatio ?? DEFAULT_CLOSING_COST_RATIO;
  const closingCost = closingCostEstimate(ctx.balance, ratio);
  const targetPayment = ctx.currentMonthlyPayment - params.targetReduction;
  const rateSolverResult = solveForRate(
    ctx.balance,
    ctx.newTermMonths,
    targetPayment,
  );
  const riCurrent = remainingInterest(
    ctx.currentMonthlyPayment,
    ctx.monthsRemaining,
    ctx.balance,
  );
  const riNew = remainingInterest(targetPayment, ctx.newTermMonths, ctx.balance);
  return {
    rateSolverResult,
    display: {
      closingCost,
      targetPayment,
      monthlySavings: params.targetReduction,
      breakEvenMonths: closingCost / params.targetReduction,
      remainingInterestCurrent: riCurrent,
      remainingInterestNew: riNew,
      totalInterestDelta: riCurrent - riNew,
      isTermReset: ctx.newTermMonths > ctx.monthsRemaining,
    },
  };
}

// ---------- §5.2 Break-Even ----------

export interface BreakEvenParams {
  /** Maximum months allowed to recover closing costs. Must be positive. */
  readonly maxMonths: number;
}

export interface BreakEvenDisplay extends RateTermRefiDisplay {
  /** Minimum monthly savings required: CC / maxMonths. */
  readonly minMonthlySavings: Dollars;
  /**
   * Break-even months. Equals maxMonths by construction; included as a
   * confirmation display value per MATH.md §5.2.
   */
  readonly breakEvenMonths: number;
}

export interface BreakEvenResult {
  readonly rateSolverResult: RateSolverResult;
  readonly display: BreakEvenDisplay;
}

/**
 * §5.2. Solve for the rate that recovers closing costs within maxMonths
 * via monthly P&I savings.
 *
 *   min_monthly_savings = CC / maxMonths
 *   P_target            = P_current - min_monthly_savings
 *   n_new               = newTermMonths
 *
 * Throws on non-positive maxMonths.
 */
export function solveBreakEven(
  ctx: RateTermRefiContext,
  params: BreakEvenParams,
): BreakEvenResult {
  if (params.maxMonths <= 0) {
    throw new Error('solveBreakEven: maxMonths must be positive');
  }
  const ratio = ctx.closingCostRatio ?? DEFAULT_CLOSING_COST_RATIO;
  const closingCost = closingCostEstimate(ctx.balance, ratio);
  const minMonthlySavings = closingCost / params.maxMonths;
  const targetPayment = ctx.currentMonthlyPayment - minMonthlySavings;
  const rateSolverResult = solveForRate(
    ctx.balance,
    ctx.newTermMonths,
    targetPayment,
  );
  const riCurrent = remainingInterest(
    ctx.currentMonthlyPayment,
    ctx.monthsRemaining,
    ctx.balance,
  );
  const riNew = remainingInterest(targetPayment, ctx.newTermMonths, ctx.balance);
  return {
    rateSolverResult,
    display: {
      closingCost,
      targetPayment,
      minMonthlySavings,
      breakEvenMonths: params.maxMonths,
      remainingInterestCurrent: riCurrent,
      remainingInterestNew: riNew,
      totalInterestDelta: riCurrent - riNew,
      isTermReset: ctx.newTermMonths > ctx.monthsRemaining,
    },
  };
}

// ---------- §5.3 Total Interest Reduction ----------

export interface TotalInterestReductionParams {
  /**
   * Target reduction in total interest, net of closing costs.
   * Must be positive.
   */
  readonly targetReduction: Dollars;
}

export interface TotalInterestReductionDisplay extends RateTermRefiDisplay {
  /** Gross interest savings: RI_current - RI_new. */
  readonly grossInterestSavings: Dollars;
  /** Net interest savings: grossInterestSavings - closingCost. */
  readonly netInterestSavings: Dollars;
}

export interface TotalInterestReductionResult {
  readonly rateSolverResult: RateSolverResult;
  readonly display: TotalInterestReductionDisplay;
}

/**
 * §5.3. Solve for the rate that reduces total interest paid (net of
 * closing costs) by targetReduction dollars.
 *
 *   target_RI_new = RI_current - targetReduction - CC
 *   P_target      = (target_RI_new + B) / newTermMonths
 *
 * MATH.md §5.3 notes that newTermMonths defaults at the UI layer to
 * monthsRemaining (same remaining term) to avoid term-reset distortion
 * of the interest comparison. The math here accepts whatever the caller
 * passes; the term-reset warning fires when newTermMonths > monthsRemaining.
 *
 * Throws on non-positive targetReduction.
 */
export function solveTotalInterestReduction(
  ctx: RateTermRefiContext,
  params: TotalInterestReductionParams,
): TotalInterestReductionResult {
  if (params.targetReduction <= 0) {
    throw new Error(
      'solveTotalInterestReduction: targetReduction must be positive',
    );
  }
  const ratio = ctx.closingCostRatio ?? DEFAULT_CLOSING_COST_RATIO;
  const closingCost = closingCostEstimate(ctx.balance, ratio);
  const riCurrent = remainingInterest(
    ctx.currentMonthlyPayment,
    ctx.monthsRemaining,
    ctx.balance,
  );
  const targetRINew = riCurrent - params.targetReduction - closingCost;
  const targetPayment = (targetRINew + ctx.balance) / ctx.newTermMonths;
  const rateSolverResult = solveForRate(
    ctx.balance,
    ctx.newTermMonths,
    targetPayment,
  );
  const riNew = remainingInterest(targetPayment, ctx.newTermMonths, ctx.balance);
  const grossInterestSavings = riCurrent - riNew;
  return {
    rateSolverResult,
    display: {
      closingCost,
      targetPayment,
      grossInterestSavings,
      netInterestSavings: grossInterestSavings - closingCost,
      remainingInterestCurrent: riCurrent,
      remainingInterestNew: riNew,
      totalInterestDelta: grossInterestSavings,
      isTermReset: ctx.newTermMonths > ctx.monthsRemaining,
    },
  };
}

// ---------- §5.4 Term Shortening ----------

export interface TermShorteningContext {
  /** Current loan balance. */
  readonly balance: Dollars;
  /** Current P&I payment, excluding taxes and insurance. */
  readonly currentMonthlyPayment: Dollars;
  /** Remaining months on the current loan. */
  readonly monthsRemaining: Months;
}

export interface TermShorteningParams {
  /** Target remaining loan term in years. Must be positive. */
  readonly targetRemainingYears: number;
}

export interface TermShorteningDisplay {
  /** Target term in months. round(targetRemainingYears * 12). */
  readonly targetTermMonths: Months;
  /**
   * Years saved relative to current remaining term:
   * (monthsRemaining - targetTermMonths) / 12.
   * Negative if the target term is longer than current remaining, which
   * defeats the goal's intent; the UI should validate before calling.
   */
  readonly yearsSaved: number;
  /** Remaining interest on the current loan. */
  readonly remainingInterestCurrent: Dollars;
  /** Remaining interest on the new loan: P_current * n_target - B. */
  readonly remainingInterestNew: Dollars;
  /**
   * Interest savings: RI_current - RI_new. Positive when target term is
   * shorter at the same payment, which is the goal's intent.
   */
  readonly interestSavings: Dollars;
}

export interface TermShorteningResult {
  readonly rateSolverResult: RateSolverResult;
  readonly display: TermShorteningDisplay;
}

/**
 * §5.4. Solve for the maximum rate that allows paying off the loan in
 * targetRemainingYears years at the current monthly payment.
 *
 *   n_target = round(targetRemainingYears * 12)
 *   P_target = P_current   (payment-neutral)
 *
 * Rate solver result interpretation in this domain:
 *
 *   infeasible_zero_rate    Current payment cannot retire the balance in
 *                           the target term even at 0% interest.
 *   trivially_achievable    Current payment already overpays for the
 *                           target term at any positive rate. No refi
 *                           required (per MATH.md §5.4).
 *   requires_extreme_rate   Unusual; target term and balance combination
 *                           requires a rate above the 20% ceiling.
 *   solved                  Maximum rate at which the target term is
 *                           reachable at the current payment.
 *
 * No closing cost in the display per MATH.md §5.4: "No break-even
 * calculation -- payment does not change."
 *
 * Throws on non-positive targetRemainingYears.
 */
export function solveTermShortening(
  ctx: TermShorteningContext,
  params: TermShorteningParams,
): TermShorteningResult {
  if (params.targetRemainingYears <= 0) {
    throw new Error(
      'solveTermShortening: targetRemainingYears must be positive',
    );
  }
  const targetTermMonths = Math.round(params.targetRemainingYears * 12);
  const rateSolverResult = solveForRate(
    ctx.balance,
    targetTermMonths,
    ctx.currentMonthlyPayment,
  );
  const riCurrent = remainingInterest(
    ctx.currentMonthlyPayment,
    ctx.monthsRemaining,
    ctx.balance,
  );
  const riNew = remainingInterest(
    ctx.currentMonthlyPayment,
    targetTermMonths,
    ctx.balance,
  );
  return {
    rateSolverResult,
    display: {
      targetTermMonths,
      yearsSaved: (ctx.monthsRemaining - targetTermMonths) / 12,
      remainingInterestCurrent: riCurrent,
      remainingInterestNew: riNew,
      interestSavings: riCurrent - riNew,
    },
  };
}
