// Totality property test for interpretTotalInterest.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { TotalInterestReductionResult } from '@when2refi/math';
import { interpretTotalInterest } from '../interpretTotalInterest';
import {
  GOAL_OUTCOME_KINDS,
  dollarArb,
  rateSolverResultArb,
  signedDollarArb,
} from './arbitraries';

const resultArb: fc.Arbitrary<TotalInterestReductionResult> = fc.record({
  rateSolverResult: rateSolverResultArb,
  display: fc.record({
    closingCost: dollarArb,
    targetPayment: signedDollarArb,
    grossInterestSavings: signedDollarArb,
    netInterestSavings: signedDollarArb,
    remainingInterestCurrent: signedDollarArb,
    remainingInterestNew: signedDollarArb,
    totalInterestDelta: signedDollarArb,
    isTermReset: fc.boolean(),
  }),
});

const ctxArb = fc.record({
  newTermMonths: fc.integer({ min: 1, max: 600 }),
  remainingTermMonths: fc.integer({ min: 1, max: 600 }),
});

describe('interpretTotalInterest', () => {
  it('is total and maps each rate-solver kind per the §4 table', () => {
    fc.assert(
      fc.property(resultArb, ctxArb, (result, ctx) => {
        const outcome = interpretTotalInterest(result, ctx);
        expect(GOAL_OUTCOME_KINDS).toContain(outcome.kind);

        switch (result.rateSolverResult.kind) {
          case 'solved':
            expect(outcome.kind).toBe('achievable');
            break;
          case 'trivially_achievable':
            expect(outcome.kind).toBe('already_met');
            if (outcome.kind === 'already_met') {
              expect(outcome.reason).toBe('rate_floor_clears_goal');
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

        if (outcome.kind !== 'infeasible') {
          const w = outcome.display.termResetWarning;
          if (w !== null) {
            expect(w.additionalMonths).toBe(
              ctx.newTermMonths - ctx.remainingTermMonths,
            );
          }
        }
      }),
    );
  });
});
