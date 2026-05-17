// §5.3 total_interest: math TotalInterestReductionResult -> GoalOutcome.
//
// Same mechanical-to-semantic mapping as payment_reduction (MATH.md §4).
// Exhaustive switch, no default clause.

import type { TotalInterestReductionResult } from '@when2refi/math';
import { monthlyRateToBps } from '@when2refi/math';
import type { GoalOutcome } from './types';
import type { TotalInterestDisplay, RateAndTermContext } from './displays';
import { buildTermResetWarning } from './displays';

export function interpretTotalInterest(
  result: TotalInterestReductionResult,
  ctx: RateAndTermContext,
): GoalOutcome<TotalInterestDisplay> {
  const d = result.display;
  const display: TotalInterestDisplay = {
    grossInterestSavings: d.grossInterestSavings,
    netInterestSavings: d.netInterestSavings,
    closingCost: d.closingCost,
    targetPayment: d.targetPayment,
    remainingInterestCurrent: d.remainingInterestCurrent,
    remainingInterestNew: d.remainingInterestNew,
    termResetWarning: buildTermResetWarning(
      d.isTermReset,
      ctx.newTermMonths,
      ctx.remainingTermMonths,
      d.totalInterestDelta,
    ),
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
