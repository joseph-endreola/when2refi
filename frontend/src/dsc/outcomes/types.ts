// Semantic outcome of a DSC goal.
//
// The math package returns *mechanical* results: a rate-solver discriminated
// union plus display numbers. The interpreters (interpret*.ts) map those onto
// this *semantic* shape — the three states the UI actually renders:
//
//   achievable   the goal needs a specific refi rate
//   already_met  no refi is needed; the goal is cleared as things stand
//   infeasible   the goal cannot be reached as stated
//
// GoalOutcome is generic over the per-goal display payload (displays.ts).

import type { Bps, Dollars } from '@when2refi/math';

/** Why a goal cannot be reached. */
export type InfeasibilityReason =
  | { kind: 'payment_floor'; minPaymentPerMonth: Dollars }
  | { kind: 'extreme_rate' }
  | { kind: 'ltv_exceeded'; maxCashOut: Dollars };

/** Why a goal needs no refi. */
export type AlreadyMetReason =
  | 'rate_floor_clears_goal' // any realistic rate clears the goal
  | 'current_payment_overpays'; // term-shortening: current payment retires balance early

export type GoalOutcome<TDisplay> =
  | { kind: 'achievable'; requiredRateBps: Bps; display: TDisplay }
  | { kind: 'already_met'; reason: AlreadyMetReason; display: TDisplay }
  | { kind: 'infeasible'; reason: InfeasibilityReason };
