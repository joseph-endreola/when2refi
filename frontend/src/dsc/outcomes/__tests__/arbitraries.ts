// Shared fast-check arbitraries for the outcome-interpreter property tests.
// Not a spec file itself (no `.test.ts` suffix) — imported by the specs.

import fc from 'fast-check';
import type { RateSolverResult } from '@when2refi/math';

/** Non-negative dollar amount. */
export const dollarArb = fc.double({
  min: 0,
  max: 1e7,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Strictly positive dollar amount. */
export const positiveDollarArb = fc.double({
  min: 1,
  max: 1e7,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Signed dollar amount (deltas, cash flow, interest deltas). */
export const signedDollarArb = fc.double({
  min: -1e7,
  max: 1e7,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * Covers all four §4 RateSolverResult kinds so an interpreter totality test
 * exercises every reachable branch, not just the ones random inputs happen
 * to hit.
 */
export const rateSolverResultArb: fc.Arbitrary<RateSolverResult> = fc.oneof(
  fc.record({
    kind: fc.constant('infeasible_zero_rate' as const),
    paymentFloor: positiveDollarArb,
  }),
  fc.constant({ kind: 'trivially_achievable' as const }),
  fc.constant({ kind: 'requires_extreme_rate' as const }),
  fc.record({
    kind: fc.constant('solved' as const),
    monthlyRate: fc.double({
      min: 0.0001 / 12,
      max: 0.2 / 12,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    iterations: fc.integer({ min: 0, max: 100 }),
  }),
);

/** The three valid GoalOutcome kinds. */
export const GOAL_OUTCOME_KINDS = [
  'achievable',
  'already_met',
  'infeasible',
] as const;
