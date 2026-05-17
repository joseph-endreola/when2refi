// §5.4 term_shortening: math TermShorteningResult -> semantic GoalOutcome.
//
// Mechanical-to-semantic mapping (MATH.md §4 / §5.4):
//   solved                -> achievable
//   trivially_achievable   -> already_met (current_payment_overpays)
//   infeasible_zero_rate   -> infeasible (payment_floor)
//   requires_extreme_rate  -> infeasible (extreme_rate)
//
// Unlike §5.1-§5.3 this goal shortens the term, so there is no term-reset
// case and the display carries no termResetWarning. Pure in the math result
// alone — no term context is needed.

import type { TermShorteningResult } from '@when2refi/math';
import { monthlyRateToBps } from '@when2refi/math';
import type { GoalOutcome } from './types';
import type { TermShorteningDisplay } from './displays';

export function interpretTermShortening(
  result: TermShorteningResult,
): GoalOutcome<TermShorteningDisplay> {
  const d = result.display;
  const display: TermShorteningDisplay = {
    targetTermMonths: d.targetTermMonths,
    yearsSaved: d.yearsSaved,
    remainingInterestCurrent: d.remainingInterestCurrent,
    remainingInterestNew: d.remainingInterestNew,
    interestSavings: d.interestSavings,
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
      return {
        kind: 'already_met',
        reason: 'current_payment_overpays',
        display,
      };
    case 'infeasible_zero_rate':
      return {
        kind: 'infeasible',
        reason: { kind: 'payment_floor', minPaymentPerMonth: rs.paymentFloor },
      };
    case 'requires_extreme_rate':
      return { kind: 'infeasible', reason: { kind: 'extreme_rate' } };
  }
}
