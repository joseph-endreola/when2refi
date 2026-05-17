// §5.1 payment_reduction: math PaymentReductionResult -> semantic GoalOutcome.
//
// Mechanical-to-semantic mapping (MATH.md §4 / §5.1):
//   solved                -> achievable
//   trivially_achievable   -> already_met (rate_floor_clears_goal)
//   infeasible_zero_rate   -> infeasible (payment_floor)
//   requires_extreme_rate  -> infeasible (extreme_rate)
//
// The switch is exhaustive with no default clause: a new RateSolverResult
// kind in the math package becomes a compile error here.

import type { PaymentReductionResult } from '@when2refi/math';
import { monthlyRateToBps } from '@when2refi/math';
import type { GoalOutcome } from './types';
import type { PaymentReductionDisplay, RateAndTermContext } from './displays';
import { buildTermResetWarning } from './displays';

export function interpretPaymentReduction(
  result: PaymentReductionResult,
  ctx: RateAndTermContext,
): GoalOutcome<PaymentReductionDisplay> {
  const d = result.display;
  const display: PaymentReductionDisplay = {
    monthlySavings: d.monthlySavings,
    closingCost: d.closingCost,
    breakEvenMonths: d.breakEvenMonths,
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
