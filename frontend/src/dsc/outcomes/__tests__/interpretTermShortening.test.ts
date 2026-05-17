// Totality property test for interpretTermShortening. Note the distinct
// already_met reason: 'current_payment_overpays' (MATH.md §5.4).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { TermShorteningResult } from '@when2refi/math';
import { interpretTermShortening } from '../interpretTermShortening';
import {
  GOAL_OUTCOME_KINDS,
  rateSolverResultArb,
  signedDollarArb,
} from './arbitraries';

const resultArb: fc.Arbitrary<TermShorteningResult> = fc.record({
  rateSolverResult: rateSolverResultArb,
  display: fc.record({
    targetTermMonths: fc.integer({ min: 1, max: 600 }),
    yearsSaved: fc.double({
      min: -40,
      max: 40,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    remainingInterestCurrent: signedDollarArb,
    remainingInterestNew: signedDollarArb,
    interestSavings: signedDollarArb,
  }),
});

describe('interpretTermShortening', () => {
  it('is total and maps each rate-solver kind per the §4 table', () => {
    fc.assert(
      fc.property(resultArb, (result) => {
        const outcome = interpretTermShortening(result);
        expect(GOAL_OUTCOME_KINDS).toContain(outcome.kind);

        switch (result.rateSolverResult.kind) {
          case 'solved':
            expect(outcome.kind).toBe('achievable');
            if (outcome.kind === 'achievable') {
              expect(typeof outcome.requiredRateBps).toBe('number');
            }
            break;
          case 'trivially_achievable':
            expect(outcome.kind).toBe('already_met');
            if (outcome.kind === 'already_met') {
              expect(outcome.reason).toBe('current_payment_overpays');
            }
            break;
          case 'infeasible_zero_rate':
            expect(outcome.kind).toBe('infeasible');
            if (outcome.kind === 'infeasible') {
              expect(outcome.reason.kind).toBe('payment_floor');
            }
            break;
          case 'requires_extreme_rate':
            expect(outcome.kind).toBe('infeasible');
            if (outcome.kind === 'infeasible') {
              expect(outcome.reason.kind).toBe('extreme_rate');
            }
            break;
        }
      }),
    );
  });
});
