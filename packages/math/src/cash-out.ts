// MATH.md §5.5 Cash-Out goal solver.
//
// Two-step structure:
//   1. LTV check. If new balance / property value exceeds maxLtv, return
//      early with the maximum cash-out available at the cap.
//   2. Rate solver (payment-neutral). Solve for the rate that allows the
//      borrower to keep the current payment on the new (higher) balance
//      over the new term.
//
// When investment-property inputs are provided (monthly gross rent,
// operating expense rate, assumed return on redeployed capital), the
// result also includes ROW analysis: a before/after snapshot of cash
// flow, DSCR, equity, and ROW, plus redeployed-capital return and the
// total-return delta. The "after" snapshot is only populated when the
// rate solver returned 'solved' — at any other outcome there is no
// solved rate to compute the new payment from.
//
// Per MATH.md §5.5, closing costs are paid out of pocket and are NOT
// rolled into the new balance for the rate solve.

import type { Dollars, AnnualRate } from './units';
import type { Months } from './amortization';
import { monthlyPayment } from './amortization.js';
import {
  DEFAULT_CLOSING_COST_RATIO,
  closingCostEstimate,
} from './closing-costs.js';
import type { RateSolverResult } from './rate-solver';
import { solveForRate } from './rate-solver.js';
import { DEFAULT_OPERATING_EXPENSE_RATE } from './investment-metrics.js';

// ---------- Constants ----------

/**
 * Maximum cash-out LTV for primary residences per MATH.md §5.5 (80%).
 * Lender convention; some lenders cap lower.
 */
export const MAX_LTV_PRIMARY = 0.80;

/**
 * Maximum cash-out LTV for investment and multi_family properties per
 * MATH.md §5.5 (75%). Lender convention.
 */
export const MAX_LTV_INVESTMENT = 0.75;

// ---------- Context ----------

/**
 * Investment-property inputs for the cash-out ROW analysis. When this
 * field is present on the context, ROW analysis is included in the
 * result; when absent, result.rowAnalysis is null.
 */
export interface CashOutInvestmentInputs {
  /** Monthly gross rent. */
  readonly monthlyGrossRent: Dollars;
  /**
   * Operating expense rate as a decimal of annual gross rent. Defaults
   * to DEFAULT_OPERATING_EXPENSE_RATE (0.40) when absent.
   */
  readonly operatingExpenseRate?: number;
  /**
   * Assumed return on redeployed capital, decimal annual. The cash
   * proceeds are projected to earn this rate elsewhere (next
   * acquisition, index fund, etc.) for purposes of total-return delta.
   */
  readonly assumedReturnRate: AnnualRate;
}

/**
 * Context for the cash-out solver. investmentInputs is optional; when
 * present, ROW analysis is computed.
 */
export interface CashOutContext {
  /** Current loan balance. */
  readonly balance: Dollars;
  /** Property value. */
  readonly propertyValue: Dollars;
  /** Current P&I monthly payment, excluding taxes and insurance. */
  readonly currentMonthlyPayment: Dollars;
  /** New term being modeled. UI default 360. */
  readonly newTermMonths: Months;
  /** Closing cost ratio. Defaults to DEFAULT_CLOSING_COST_RATIO (0.025). */
  readonly closingCostRatio?: number;
  /**
   * Maximum LTV for this property type. MAX_LTV_PRIMARY (0.80) or
   * MAX_LTV_INVESTMENT (0.75) per MATH.md §5.5; lower if the lender
   * imposes a tighter cap.
   */
  readonly maxLtv: number;
  /** Optional. Provide for investment-property ROW analysis. */
  readonly investmentInputs?: CashOutInvestmentInputs;
}

export interface CashOutParams {
  /** Cash to extract. Must be positive. */
  readonly cashOutAmount: Dollars;
}

// ---------- Result types ----------

/**
 * LTV-exceeded branch. Cash-out as requested would exceed maxLtv. The
 * rate solver does not run; the display tells the user the maximum
 * cash-out available at the cap.
 */
export interface CashOutLtvExceeded {
  readonly kind: 'ltv_exceeded';
  /** balance + cashOutAmount. */
  readonly newBalance: Dollars;
  /** newBalance / propertyValue. */
  readonly newLtv: number;
  /** The cap that was exceeded. */
  readonly maxLtv: number;
  /**
   * propertyValue * maxLtv - balance. Clamped at 0 when the property
   * is already at or above maxLtv before any cash-out.
   */
  readonly maxCashOut: Dollars;
}

/**
 * "Before" snapshot of investment economics. Computed entirely from
 * current loan facts; no rate solve required.
 */
export interface CashOutRowAnalysisBefore {
  readonly monthlyPayment: Dollars;
  readonly annualGrossRent: Dollars;
  readonly operatingExpenses: Dollars;
  readonly netOperatingIncome: Dollars;
  readonly annualDebtService: Dollars;
  readonly cashFlowAnnual: Dollars;
  readonly equity: Dollars;
  /** Null when annualDebtService is 0 (paid-off case). */
  readonly debtServiceCoverage: number | null;
  /** Null when equity is non-positive. */
  readonly returnOnWealth: AnnualRate | null;
}

/**
 * "After" snapshot at the solved rate. Only populated when the rate
 * solver returned 'solved'; null on any other rateSolverResult kind
 * because there is no solved rate to compute the new payment.
 */
export interface CashOutRowAnalysisAfter {
  readonly monthlyPayment: Dollars;
  readonly annualDebtService: Dollars;
  readonly cashFlowAnnual: Dollars;
  readonly equity: Dollars;
  readonly debtServiceCoverage: number | null;
  readonly returnOnWealth: AnnualRate | null;
  /** cashOutAmount * assumedReturnRate. */
  readonly redeployedReturn: Dollars;
  /** cashFlowAnnual + redeployedReturn. */
  readonly totalReturnAfter: Dollars;
}

export interface CashOutRowAnalysis {
  readonly before: CashOutRowAnalysisBefore;
  /** Null when rateSolverResult.kind is not 'solved'. */
  readonly after: CashOutRowAnalysisAfter | null;
  /** after.totalReturnAfter - before.cashFlowAnnual. Null when after is null. */
  readonly totalReturnDelta: Dollars | null;
}

/**
 * Rate-check branch. LTV passed. The rate solver ran; callers check
 * rateSolverResult.kind to decide how to render the rate slot.
 * rowAnalysis is populated only when investmentInputs was provided.
 */
export interface CashOutRateCheck {
  readonly kind: 'rate_check';
  readonly newBalance: Dollars;
  readonly newLtv: number;
  readonly maxLtv: number;
  readonly rateSolverResult: RateSolverResult;
  /** propertyValue - newBalance. */
  readonly equityRemaining: Dollars;
  /** Closing cost on the new (refi) balance. Paid out of pocket. */
  readonly closingCost: Dollars;
  /** Populated when investmentInputs was provided; null otherwise. */
  readonly rowAnalysis: CashOutRowAnalysis | null;
}

export type CashOutResult = CashOutLtvExceeded | CashOutRateCheck;

// ---------- Solver ----------

/**
 * §5.5 cash-out solver.
 *
 * Two-step structure:
 *
 *   1. LTV check. If newBalance / propertyValue > maxLtv, returns
 *      kind: 'ltv_exceeded' with the maxCashOut available at the cap.
 *      No rate solve in this case.
 *   2. Otherwise, run the rate solver payment-neutral on (newBalance,
 *      newTermMonths, currentMonthlyPayment) and return
 *      kind: 'rate_check' with the rateSolverResult, LTV/equity/closing
 *      cost display fields, and optional ROW analysis.
 *
 * Closing costs are paid out of pocket per MATH.md §5.5; they are
 * computed for display but NOT added to newBalance for the rate solve.
 *
 * Throws on non-positive cashOutAmount.
 */
export function solveCashOut(
  ctx: CashOutContext,
  params: CashOutParams,
): CashOutResult {
  if (params.cashOutAmount <= 0) {
    throw new Error('solveCashOut: cashOutAmount must be positive');
  }

  const newBalance = ctx.balance + params.cashOutAmount;
  const newLtv = newBalance / ctx.propertyValue;

  if (newLtv > ctx.maxLtv) {
    const maxCashOutRaw = ctx.propertyValue * ctx.maxLtv - ctx.balance;
    return {
      kind: 'ltv_exceeded',
      newBalance,
      newLtv,
      maxLtv: ctx.maxLtv,
      maxCashOut: Math.max(0, maxCashOutRaw),
    };
  }

  const rateSolverResult = solveForRate(
    newBalance,
    ctx.newTermMonths,
    ctx.currentMonthlyPayment,
  );

  const closingCostRatio = ctx.closingCostRatio ?? DEFAULT_CLOSING_COST_RATIO;
  const closingCost = closingCostEstimate(newBalance, closingCostRatio);

  const rowAnalysis = ctx.investmentInputs
    ? computeRowAnalysis({
        inv: ctx.investmentInputs,
        currentMonthlyPayment: ctx.currentMonthlyPayment,
        propertyValue: ctx.propertyValue,
        balance: ctx.balance,
        newBalance,
        newTermMonths: ctx.newTermMonths,
        cashOutAmount: params.cashOutAmount,
        rateSolverResult,
      })
    : null;

  return {
    kind: 'rate_check',
    newBalance,
    newLtv,
    maxLtv: ctx.maxLtv,
    rateSolverResult,
    equityRemaining: ctx.propertyValue - newBalance,
    closingCost,
    rowAnalysis,
  };
}

/**
 * Internal helper. Computes the before snapshot from current loan facts
 * unconditionally, and the after snapshot only when the rate solver
 * returned 'solved'.
 */
function computeRowAnalysis(args: {
  readonly inv: CashOutInvestmentInputs;
  readonly currentMonthlyPayment: Dollars;
  readonly propertyValue: Dollars;
  readonly balance: Dollars;
  readonly newBalance: Dollars;
  readonly newTermMonths: Months;
  readonly cashOutAmount: Dollars;
  readonly rateSolverResult: RateSolverResult;
}): CashOutRowAnalysis {
  const expenseRate =
    args.inv.operatingExpenseRate ?? DEFAULT_OPERATING_EXPENSE_RATE;
  const annualGrossRent = args.inv.monthlyGrossRent * 12;
  const operatingExpenses = annualGrossRent * expenseRate;
  const noi = annualGrossRent - operatingExpenses;

  // Before snapshot: no rate solve required.
  const adsBefore = args.currentMonthlyPayment * 12;
  const cashFlowBefore = noi - adsBefore;
  const equityBefore = args.propertyValue - args.balance;
  const before: CashOutRowAnalysisBefore = {
    monthlyPayment: args.currentMonthlyPayment,
    annualGrossRent,
    operatingExpenses,
    netOperatingIncome: noi,
    annualDebtService: adsBefore,
    cashFlowAnnual: cashFlowBefore,
    equity: equityBefore,
    debtServiceCoverage: adsBefore > 0 ? noi / adsBefore : null,
    returnOnWealth: equityBefore > 0 ? cashFlowBefore / equityBefore : null,
  };

  // After snapshot: only when the rate solver returned 'solved'.
  let after: CashOutRowAnalysisAfter | null = null;
  if (args.rateSolverResult.kind === 'solved') {
    const newPayment = monthlyPayment(
      args.newBalance,
      args.rateSolverResult.monthlyRate,
      args.newTermMonths,
    );
    const adsAfter = newPayment * 12;
    const cashFlowAfter = noi - adsAfter;
    const equityAfter = args.propertyValue - args.newBalance;
    const redeployedReturn = args.cashOutAmount * args.inv.assumedReturnRate;
    after = {
      monthlyPayment: newPayment,
      annualDebtService: adsAfter,
      cashFlowAnnual: cashFlowAfter,
      equity: equityAfter,
      debtServiceCoverage: adsAfter > 0 ? noi / adsAfter : null,
      returnOnWealth: equityAfter > 0 ? cashFlowAfter / equityAfter : null,
      redeployedReturn,
      totalReturnAfter: cashFlowAfter + redeployedReturn,
    };
  }

  return {
    before,
    after,
    totalReturnDelta:
      after !== null ? after.totalReturnAfter - cashFlowBefore : null,
  };
}
