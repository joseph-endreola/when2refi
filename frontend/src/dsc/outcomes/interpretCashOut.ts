// §5.5 cash_out: math CashOutResult -> semantic GoalOutcome.
//
// The 'ltv_exceeded' branch is handled first: it maps straight to
// infeasible { kind: 'ltv_exceeded', maxCashOut }, with no rate solve.
//
// The 'rate_check' branch maps through the same §4 table as the other goals
// (solved / trivially_achievable / infeasible_zero_rate / requires_extreme_rate)
// and additionally reshapes the ROW analysis, running the post-refi DSCR
// through the threshold booleans. Exhaustive switch, no default clause.

import type {
  CashOutResult,
  CashOutRowAnalysis,
} from '@when2refi/math';
import { monthlyRateToBps } from '@when2refi/math';
import type { GoalOutcome } from './types';
import type {
  CashOutDisplay,
  RowAnalysisAfterDisplay,
  RowAnalysisDisplay,
} from './displays';
import { computeDscrBreaches } from './displays';

function mapRowAnalysis(
  row: CashOutRowAnalysis | null,
): RowAnalysisDisplay | null {
  if (row === null) return null;

  const after: RowAnalysisAfterDisplay | null =
    row.after === null
      ? null
      : {
          monthlyPayment: row.after.monthlyPayment,
          annualDebtService: row.after.annualDebtService,
          cashFlowAnnual: row.after.cashFlowAnnual,
          equity: row.after.equity,
          debtServiceCoverage: row.after.debtServiceCoverage,
          returnOnWealth: row.after.returnOnWealth,
          redeployedReturn: row.after.redeployedReturn,
          totalReturnAfter: row.after.totalReturnAfter,
        };

  return {
    before: {
      monthlyPayment: row.before.monthlyPayment,
      annualGrossRent: row.before.annualGrossRent,
      operatingExpenses: row.before.operatingExpenses,
      netOperatingIncome: row.before.netOperatingIncome,
      annualDebtService: row.before.annualDebtService,
      cashFlowAnnual: row.before.cashFlowAnnual,
      equity: row.before.equity,
      debtServiceCoverage: row.before.debtServiceCoverage,
      returnOnWealth: row.before.returnOnWealth,
    },
    after,
    totalReturnDelta: row.totalReturnDelta,
    // MATH.md §5.5 flags the post-refi DSCR; null when there is no 'after'.
    dscrBreaches: computeDscrBreaches(
      after === null ? null : after.debtServiceCoverage,
    ),
  };
}

export function interpretCashOut(
  result: CashOutResult,
): GoalOutcome<CashOutDisplay> {
  if (result.kind === 'ltv_exceeded') {
    return {
      kind: 'infeasible',
      reason: { kind: 'ltv_exceeded', maxCashOut: result.maxCashOut },
    };
  }

  const display: CashOutDisplay = {
    newBalance: result.newBalance,
    newLtv: result.newLtv,
    maxLtv: result.maxLtv,
    equityRemaining: result.equityRemaining,
    closingCost: result.closingCost,
    rowAnalysis: mapRowAnalysis(result.rowAnalysis),
  };

  const rs = result.rateSolverResult;
  switch (rs.kind) {
    case 'solved':
      return {
        kind: 'achievable',
        requiredRateBps: monthlyRateToBps(rs.monthlyRate),
        display,
      };
    case 'trivially_achievable':
      return { kind: 'already_met', reason: 'rate_floor_clears_goal', display };
    case 'infeasible_zero_rate':
      return {
        kind: 'infeasible',
        reason: { kind: 'payment_floor', minPaymentPerMonth: rs.paymentFloor },
      };
    case 'requires_extreme_rate':
      return { kind: 'infeasible', reason: { kind: 'extreme_rate' } };
  }
}
