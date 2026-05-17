// §5.2 break_even: math BreakEvenResult -> semantic GoalOutcome.
//
// Same mechanical-to-semantic mapping as payment_reduction (MATH.md §4):
//   solved / trivially_achievable / infeasible_zero_rate / requires_extreme_rate.
// Exhaustive switch, no default clause.

import type { BreakEvenResult } from '@when2refi/math';
import { monthlyRateToBps } from '@when2refi/math';
import type { GoalOutcome } from './types';
import type { BreakEvenDisplay, RateAndTermContext } from './displays';
import { buildTermResetWarning } from './displays';

export function interpretBreakEven(
  result: BreakEvenResult,
  ctx: RateAndTermContext,
): GoalOutcome<BreakEvenDisplay> {
  const d = result.display;
  const display: BreakEvenDisplay = {
    minMonthlySavings: d.minMonthlySavings,
    breakEvenMonths: d.breakEvenMonths,
    closingCost: d.closingCost,
    targetPayment: d.targetPayment,
    remainingInterestCurrent: d.remainingInterestCurrent,
    remainingInterestNew: d.remainingInterestNew,
    totalInterestDelta: d.totalInterestDelta,
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
