// Per-goal display payloads carried by a GoalOutcome.
//
// These are the *semantic* display shapes the DSC right panel consumes. The
// interpreters reshape each math solver's raw `display` payload into one of
// these. Two small pure constructors (computeDscrBreaches, buildTermResetWarning)
// live here because they build display sub-values shared across interpreters.

import type { Dollars, Months } from '@when2refi/math';
import {
  DSCR_CASH_FLOW_WARNING_THRESHOLD,
  DSCR_LOAN_ELIGIBILITY_THRESHOLD,
} from '@when2refi/math';

// ---------- Term reset warning ----------

/**
 * Surfaced when a refi resets the term longer than the loan's remaining term
 * (MATH.md §5.1). `totalInterestDelta` is positive for net savings, negative
 * when the term extension outweighs the rate improvement.
 */
export type TermResetWarning = {
  newTermMonths: Months;
  remainingTermMonths: Months;
  additionalMonths: Months;
  totalInterestDelta: Dollars;
};

/**
 * Term context an interpreter needs to build a TermResetWarning. The math
 * solver's `display` payload reports `isTermReset` but not the term lengths
 * themselves, so the rate-and-term interpreters take this alongside the
 * solver result.
 */
export type RateAndTermContext = {
  newTermMonths: Months;
  remainingTermMonths: Months;
};

/**
 * Build a TermResetWarning, or null when the new term does not extend past
 * the remaining term. `additionalMonths` is exactly
 * `newTermMonths - remainingTermMonths`.
 */
export function buildTermResetWarning(
  isTermReset: boolean,
  newTermMonths: Months,
  remainingTermMonths: Months,
  totalInterestDelta: Dollars,
): TermResetWarning | null {
  if (!isTermReset) return null;
  return {
    newTermMonths,
    remainingTermMonths,
    additionalMonths: newTermMonths - remainingTermMonths,
    totalInterestDelta,
  };
}

// ---------- DSCR breaches ----------

/** Precomputed DSCR threshold breaches (MATH.md §6). */
export type DscrBreaches = {
  /** true when DSCR < DSCR_CASH_FLOW_WARNING_THRESHOLD (1.00). */
  cashFlow: boolean;
  /** true when DSCR < DSCR_LOAN_ELIGIBILITY_THRESHOLD (1.25). */
  loanEligibility: boolean;
};

/**
 * Evaluate DSCR threshold breaches. A null DSCR (no debt service, or no
 * post-refi snapshot) is not a breach — both flags are false.
 */
export function computeDscrBreaches(dscr: number | null): DscrBreaches {
  if (dscr === null || !Number.isFinite(dscr)) {
    return { cashFlow: false, loanEligibility: false };
  }
  return {
    cashFlow: dscr < DSCR_CASH_FLOW_WARNING_THRESHOLD,
    loanEligibility: dscr < DSCR_LOAN_ELIGIBILITY_THRESHOLD,
  };
}

// ---------- Rate-and-term goal displays (§5.1, §5.2, §5.3) ----------

export type PaymentReductionDisplay = {
  monthlySavings: Dollars;
  closingCost: Dollars;
  breakEvenMonths: number;
  targetPayment: Dollars;
  remainingInterestCurrent: Dollars;
  remainingInterestNew: Dollars;
  totalInterestDelta: Dollars;
  termResetWarning: TermResetWarning | null;
};

export type BreakEvenDisplay = {
  minMonthlySavings: Dollars;
  breakEvenMonths: number;
  closingCost: Dollars;
  targetPayment: Dollars;
  remainingInterestCurrent: Dollars;
  remainingInterestNew: Dollars;
  totalInterestDelta: Dollars;
  termResetWarning: TermResetWarning | null;
};

export type TotalInterestDisplay = {
  grossInterestSavings: Dollars;
  netInterestSavings: Dollars;
  closingCost: Dollars;
  targetPayment: Dollars;
  remainingInterestCurrent: Dollars;
  remainingInterestNew: Dollars;
  termResetWarning: TermResetWarning | null;
};

// ---------- Term shortening display (§5.4) ----------
// No termResetWarning: §5.4 shortens the term and has no term-reset case.

export type TermShorteningDisplay = {
  targetTermMonths: Months;
  yearsSaved: number;
  remainingInterestCurrent: Dollars;
  remainingInterestNew: Dollars;
  interestSavings: Dollars;
};

// ---------- Cash-out / ROW analysis displays (§5.5) ----------

export type RowAnalysisBeforeDisplay = {
  monthlyPayment: Dollars;
  annualGrossRent: Dollars;
  operatingExpenses: Dollars;
  netOperatingIncome: Dollars;
  annualDebtService: Dollars;
  cashFlowAnnual: Dollars;
  equity: Dollars;
  debtServiceCoverage: number | null;
  returnOnWealth: number | null;
};

export type RowAnalysisAfterDisplay = {
  monthlyPayment: Dollars;
  annualDebtService: Dollars;
  cashFlowAnnual: Dollars;
  equity: Dollars;
  debtServiceCoverage: number | null;
  returnOnWealth: number | null;
  redeployedReturn: Dollars;
  totalReturnAfter: Dollars;
};

export type RowAnalysisDisplay = {
  before: RowAnalysisBeforeDisplay;
  /** null when the rate solver did not return 'solved'. */
  after: RowAnalysisAfterDisplay | null;
  /** null when `after` is null. */
  totalReturnDelta: Dollars | null;
  /**
   * Breaches against the post-refi DSCR — the figure MATH.md §5.5 directs the
   * UI to flag. Both flags false when there is no post-refi snapshot.
   */
  dscrBreaches: DscrBreaches;
};

export type CashOutDisplay = {
  newBalance: Dollars;
  newLtv: number;
  maxLtv: number;
  equityRemaining: Dollars;
  closingCost: Dollars;
  /** null on a primary residence (no income / ROW analysis). */
  rowAnalysis: RowAnalysisDisplay | null;
};

// ---------- Tax optimization display (§5.6) ----------
// disclaimer is required, never optional — it cannot be rendered without it.

export type TaxOptimizationDisplay =
  | {
      kind: 'primary';
      disclaimer: string;
      annualInterest: Dollars;
      deductibleBalanceCap: Dollars;
      fullyDeductible: boolean;
      deductibleInterest: Dollars;
      estimatedTaxBenefit: Dollars | null;
    }
  | {
      kind: 'investment';
      disclaimer: string;
      annualInterest: Dollars;
      annualDepreciation: Dollars;
      accumulatedDepreciation: Dollars | null;
      depreciationSource: 'purchase_records' | 'estimated_from_value';
      combinedAnnualDeduction: Dollars;
      estimatedTaxShield: Dollars | null;
      recaptureNote: string;
    };
