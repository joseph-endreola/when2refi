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
 *   - goal solvers (MATH.md §5.1–§5.4)
 *   - cash-out (MATH.md §5.5)
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

export {
  closingCostEstimate,
  DEFAULT_CLOSING_COST_RATIO,
} from './closing-costs.js';

export {
  solveForRate,
} from './rate-solver.js';
export type {
  RateSolverResult,
} from './rate-solver.js';

export {
  solvePaymentReduction,
  solveBreakEven,
  solveTotalInterestReduction,
  solveTermShortening,
} from './goal-solvers.js';
export type {
  RateTermRefiContext,
  RateTermRefiDisplay,
  PaymentReductionParams,
  PaymentReductionDisplay,
  PaymentReductionResult,
  BreakEvenParams,
  BreakEvenDisplay,
  BreakEvenResult,
  TotalInterestReductionParams,
  TotalInterestReductionDisplay,
  TotalInterestReductionResult,
  TermShorteningContext,
  TermShorteningParams,
  TermShorteningDisplay,
  TermShorteningResult,
} from './goal-solvers.js';

export {
  DEFAULT_OPERATING_EXPENSE_RATE,
  STRUCTURE_VALUE_RATIO,
  DEPRECIATION_LIFE_YEARS,
  DSCR_CASH_FLOW_WARNING_THRESHOLD,
  DSCR_LOAN_ELIGIBILITY_THRESHOLD,
  computeIncomeMetrics,
  computeDepreciation,
} from './investment-metrics.js';
export type {
  IncomeMetricsContext,
  IncomeMetrics,
  DepreciationContext,
  DepreciationMetrics,
} from './investment-metrics.js';

export {
  MAX_LTV_PRIMARY,
  MAX_LTV_INVESTMENT,
  solveCashOut,
} from './cash-out.js';
export type {
  CashOutInvestmentInputs,
  CashOutContext,
  CashOutParams,
  CashOutLtvExceeded,
  CashOutRowAnalysisBefore,
  CashOutRowAnalysisAfter,
  CashOutRowAnalysis,
  CashOutRateCheck,
  CashOutResult,
} from './cash-out.js';
