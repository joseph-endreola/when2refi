// Property-based tests for src/goal-solvers.ts — the four rate-and-term
// goal solvers (MATH.md §5.1 through §5.4). Each solver's display values
// are pure functions of the inputs; the rateSolverResult delegates to
// solveForRate over the computed (B, n, P_target) triple.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { monthlyPayment } from '../src/amortization.js';
import {
  DEFAULT_CLOSING_COST_RATIO,
  closingCostEstimate,
} from '../src/closing-costs.js';
import { solveForRate } from '../src/rate-solver.js';
import {
  solvePaymentReduction,
  solveBreakEven,
  solveTotalInterestReduction,
  solveTermShortening,
} from '../src/goal-solvers.js';
import type {
  RateTermRefiContext,
  TermShorteningContext,
} from '../src/goal-solvers.js';
import type { RateSolverResult } from '../src/rate-solver.js';

// ---------- Generators ----------

const balanceArb = fc.double({
  min: 10_000,
  max: 1e7,
  noNaN: true,
  noDefaultInfinity: true,
});

const paymentArb = fc.double({
  min: 100,
  max: 1e5,
  noNaN: true,
  noDefaultInfinity: true,
});

const monthsRemainingArb = fc.integer({ min: 12, max: 480 });

const newTermArb = fc.constantFrom(180, 240, 360);

const closingCostRatioArb = fc.double({
  min: 0,
  max: 0.1,
  noNaN: true,
  noDefaultInfinity: true,
});

const targetReductionArb = fc.double({
  min: 0.01,
  max: 5000,
  noNaN: true,
  noDefaultInfinity: true,
});

const maxMonthsArb = fc.integer({ min: 1, max: 240 });

const targetRemainingYearsArb = fc.double({
  min: 0.5,
  max: 40,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * Shared rate-and-term refi context generator (§5.1, §5.2, §5.3).
 * closingCostRatio is sometimes absent, exercising both the explicit-ratio
 * and DEFAULT_CLOSING_COST_RATIO paths.
 */
const refiContextArb: fc.Arbitrary<RateTermRefiContext> = fc.record(
  {
    balance: balanceArb,
    currentMonthlyPayment: paymentArb,
    monthsRemaining: monthsRemainingArb,
    newTermMonths: newTermArb,
    closingCostRatio: closingCostRatioArb,
  },
  {
    requiredKeys: [
      'balance',
      'currentMonthlyPayment',
      'monthsRemaining',
      'newTermMonths',
    ],
  },
);

/** Term-shortening context generator (§5.4). */
const termContextArb: fc.Arbitrary<TermShorteningContext> = fc.record({
  balance: balanceArb,
  currentMonthlyPayment: paymentArb,
  monthsRemaining: monthsRemainingArb,
});

/**
 * Round-trip rates: a target rate strictly inside (0.0002/12, 0.10/12) and
 * a gap of at least 0.001/12, so r_current = r_target + gap stays inside
 * the bisection band with meaningful separation.
 */
const roundTripTargetRateArb = fc.double({
  min: 0.0002 / 12,
  max: 0.1 / 12,
  noNaN: true,
  noDefaultInfinity: true,
});
const roundTripGapArb = fc.double({
  min: 0.001 / 12,
  max: 0.05 / 12,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Compare two RateSolverResults: same kind, and on 'solved' same fields. */
const sameRateSolverResult = (
  a: RateSolverResult,
  b: RateSolverResult,
): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'solved' && b.kind === 'solved') {
    return a.monthlyRate === b.monthlyRate && a.iterations === b.iterations;
  }
  return true;
};

// ---------- §5.1 Payment Reduction ----------

describe('solvePaymentReduction', () => {
  it('throws on a non-positive targetReduction', () => {
    for (const targetReduction of [0, -1, -100]) {
      expect(() =>
        solvePaymentReduction(
          {
            balance: 300_000,
            currentMonthlyPayment: 2000,
            monthsRemaining: 360,
            newTermMonths: 360,
          },
          { targetReduction },
        ),
      ).toThrow();
    }
  });

  it('display values match the §5.1 formulas', () => {
    fc.assert(
      fc.property(refiContextArb, targetReductionArb, (ctx, targetReduction) => {
        const { display } = solvePaymentReduction(ctx, { targetReduction });
        const ratio = ctx.closingCostRatio ?? DEFAULT_CLOSING_COST_RATIO;
        expect(display.closingCost).toBe(ctx.balance * ratio);
        expect(display.targetPayment).toBe(
          ctx.currentMonthlyPayment - targetReduction,
        );
        expect(display.monthlySavings).toBe(targetReduction);
        expect(display.breakEvenMonths).toBe(
          display.closingCost / display.monthlySavings,
        );
        expect(display.remainingInterestCurrent).toBe(
          ctx.currentMonthlyPayment * ctx.monthsRemaining - ctx.balance,
        );
        expect(display.remainingInterestNew).toBe(
          display.targetPayment * ctx.newTermMonths - ctx.balance,
        );
        expect(display.totalInterestDelta).toBe(
          display.remainingInterestCurrent - display.remainingInterestNew,
        );
        expect(display.isTermReset).toBe(
          ctx.newTermMonths > ctx.monthsRemaining,
        );
        return true;
      }),
    );
  });

  it('delegates to solveForRate over (B, newTermMonths, targetPayment)', () => {
    fc.assert(
      fc.property(refiContextArb, targetReductionArb, (ctx, targetReduction) => {
        const { rateSolverResult, display } = solvePaymentReduction(ctx, {
          targetReduction,
        });
        const direct = solveForRate(
          ctx.balance,
          ctx.newTermMonths,
          display.targetPayment,
        );
        return sameRateSolverResult(rateSolverResult, direct);
      }),
    );
  });

  it('round-trip: recovers the rate behind a constructed target reduction', () => {
    fc.assert(
      fc.property(
        balanceArb,
        fc.constantFrom(180, 240, 360),
        roundTripTargetRateArb,
        roundTripGapArb,
        (b, n, rTarget, gap) => {
          const rCurrent = rTarget + gap;
          const currentPayment = monthlyPayment(b, rCurrent, n);
          const targetPayment = monthlyPayment(b, rTarget, n);
          const targetReduction = currentPayment - targetPayment;
          const { rateSolverResult } = solvePaymentReduction(
            {
              balance: b,
              currentMonthlyPayment: currentPayment,
              monthsRemaining: n,
              newTermMonths: n,
            },
            { targetReduction },
          );
          expect(rateSolverResult.kind).toBe('solved');
          if (rateSolverResult.kind !== 'solved') return false;
          return Math.abs(rateSolverResult.monthlyRate - rTarget) < 1e-8;
        },
      ),
    );
  });
});

// ---------- §5.2 Break-Even ----------

describe('solveBreakEven', () => {
  it('throws on a non-positive maxMonths', () => {
    for (const maxMonths of [0, -1, -12]) {
      expect(() =>
        solveBreakEven(
          {
            balance: 300_000,
            currentMonthlyPayment: 2000,
            monthsRemaining: 360,
            newTermMonths: 360,
          },
          { maxMonths },
        ),
      ).toThrow();
    }
  });

  it('display values match the §5.2 formulas', () => {
    fc.assert(
      fc.property(refiContextArb, maxMonthsArb, (ctx, maxMonths) => {
        const { display } = solveBreakEven(ctx, { maxMonths });
        const ratio = ctx.closingCostRatio ?? DEFAULT_CLOSING_COST_RATIO;
        expect(display.closingCost).toBe(ctx.balance * ratio);
        expect(display.minMonthlySavings).toBe(display.closingCost / maxMonths);
        expect(display.breakEvenMonths).toBe(maxMonths);
        expect(display.targetPayment).toBe(
          ctx.currentMonthlyPayment - display.minMonthlySavings,
        );
        expect(display.remainingInterestCurrent).toBe(
          ctx.currentMonthlyPayment * ctx.monthsRemaining - ctx.balance,
        );
        expect(display.remainingInterestNew).toBe(
          display.targetPayment * ctx.newTermMonths - ctx.balance,
        );
        expect(display.totalInterestDelta).toBe(
          display.remainingInterestCurrent - display.remainingInterestNew,
        );
        expect(display.isTermReset).toBe(
          ctx.newTermMonths > ctx.monthsRemaining,
        );
        return true;
      }),
    );
  });

  it('is equivalent to solvePaymentReduction with targetReduction = CC / maxMonths', () => {
    fc.assert(
      fc.property(refiContextArb, maxMonthsArb, (ctx, maxMonths) => {
        const cc = closingCostEstimate(
          ctx.balance,
          ctx.closingCostRatio ?? DEFAULT_CLOSING_COST_RATIO,
        );
        const targetReduction = cc / maxMonths;
        // Equivalence is defined only for a positive reduction; a zero
        // closing-cost ratio yields CC = 0 and solvePaymentReduction throws.
        if (targetReduction <= 0) return true;
        const be = solveBreakEven(ctx, { maxMonths });
        const pr = solvePaymentReduction(ctx, { targetReduction });
        expect(
          sameRateSolverResult(be.rateSolverResult, pr.rateSolverResult),
        ).toBe(true);
        expect(be.display.targetPayment).toBe(pr.display.targetPayment);
        expect(be.display.minMonthlySavings).toBe(pr.display.monthlySavings);
        expect(be.display.closingCost).toBe(pr.display.closingCost);
        return true;
      }),
    );
  });
});

// ---------- §5.3 Total Interest Reduction ----------

describe('solveTotalInterestReduction', () => {
  it('throws on a non-positive targetReduction', () => {
    for (const targetReduction of [0, -1, -100]) {
      expect(() =>
        solveTotalInterestReduction(
          {
            balance: 300_000,
            currentMonthlyPayment: 2000,
            monthsRemaining: 360,
            newTermMonths: 360,
          },
          { targetReduction },
        ),
      ).toThrow();
    }
  });

  it('display values match the §5.3 formulas', () => {
    fc.assert(
      fc.property(refiContextArb, targetReductionArb, (ctx, targetReduction) => {
        const { display } = solveTotalInterestReduction(ctx, {
          targetReduction,
        });
        const ratio = ctx.closingCostRatio ?? DEFAULT_CLOSING_COST_RATIO;
        expect(display.closingCost).toBe(ctx.balance * ratio);
        expect(display.remainingInterestCurrent).toBe(
          ctx.currentMonthlyPayment * ctx.monthsRemaining - ctx.balance,
        );
        expect(display.targetPayment).toBe(
          (display.remainingInterestCurrent -
            targetReduction -
            display.closingCost +
            ctx.balance) /
            ctx.newTermMonths,
        );
        expect(display.remainingInterestNew).toBe(
          display.targetPayment * ctx.newTermMonths - ctx.balance,
        );
        expect(display.grossInterestSavings).toBe(
          display.remainingInterestCurrent - display.remainingInterestNew,
        );
        expect(display.netInterestSavings).toBe(
          display.grossInterestSavings - display.closingCost,
        );
        expect(display.totalInterestDelta).toBe(display.grossInterestSavings);
        return true;
      }),
    );
  });

  it('keystone: net interest savings equal the requested targetReduction', () => {
    fc.assert(
      fc.property(refiContextArb, targetReductionArb, (ctx, targetReduction) => {
        const { display } = solveTotalInterestReduction(ctx, {
          targetReduction,
        });
        return Math.abs(display.netInterestSavings - targetReduction) < 1e-6;
      }),
    );
  });

  it('delegates to solveForRate over (B, newTermMonths, targetPayment)', () => {
    fc.assert(
      fc.property(refiContextArb, targetReductionArb, (ctx, targetReduction) => {
        const { rateSolverResult, display } = solveTotalInterestReduction(
          ctx,
          { targetReduction },
        );
        const direct = solveForRate(
          ctx.balance,
          ctx.newTermMonths,
          display.targetPayment,
        );
        return sameRateSolverResult(rateSolverResult, direct);
      }),
    );
  });
});

// ---------- §5.4 Term Shortening ----------

describe('solveTermShortening', () => {
  it('throws on a non-positive targetRemainingYears', () => {
    for (const targetRemainingYears of [0, -1, -10]) {
      expect(() =>
        solveTermShortening(
          {
            balance: 300_000,
            currentMonthlyPayment: 2000,
            monthsRemaining: 360,
          },
          { targetRemainingYears },
        ),
      ).toThrow();
    }
  });

  it('display values match the §5.4 formulas', () => {
    fc.assert(
      fc.property(termContextArb, targetRemainingYearsArb, (ctx, years) => {
        const { display } = solveTermShortening(ctx, {
          targetRemainingYears: years,
        });
        expect(display.targetTermMonths).toBe(Math.round(years * 12));
        expect(display.yearsSaved).toBe(
          (ctx.monthsRemaining - display.targetTermMonths) / 12,
        );
        expect(display.remainingInterestCurrent).toBe(
          ctx.currentMonthlyPayment * ctx.monthsRemaining - ctx.balance,
        );
        expect(display.remainingInterestNew).toBe(
          ctx.currentMonthlyPayment * display.targetTermMonths - ctx.balance,
        );
        expect(display.interestSavings).toBe(
          display.remainingInterestCurrent - display.remainingInterestNew,
        );
        return true;
      }),
    );
  });

  it('delegates to solveForRate over (B, targetTermMonths, currentMonthlyPayment)', () => {
    fc.assert(
      fc.property(termContextArb, targetRemainingYearsArb, (ctx, years) => {
        const { rateSolverResult, display } = solveTermShortening(ctx, {
          targetRemainingYears: years,
        });
        const direct = solveForRate(
          ctx.balance,
          display.targetTermMonths,
          ctx.currentMonthlyPayment,
        );
        return sameRateSolverResult(rateSolverResult, direct);
      }),
    );
  });

  it('permits a negative yearsSaved when the target term exceeds remaining', () => {
    fc.assert(
      fc.property(termContextArb, (ctx) => {
        // Target term double the remaining term → negative yearsSaved.
        const years = (ctx.monthsRemaining * 2) / 12;
        const { display } = solveTermShortening(ctx, {
          targetRemainingYears: years,
        });
        return display.yearsSaved < 0;
      }),
    );
  });

  it('canonical case A: current payment insufficient → infeasible_zero_rate', () => {
    const result = solveTermShortening(
      { balance: 300_000, currentMonthlyPayment: 1500, monthsRemaining: 360 },
      { targetRemainingYears: 10 },
    );
    expect(result.rateSolverResult.kind).toBe('infeasible_zero_rate');
    if (result.rateSolverResult.kind === 'infeasible_zero_rate') {
      expect(result.rateSolverResult.paymentFloor).toBe(2500);
    }
  });

  it('canonical case B: payment in the zero-rate band → trivially_achievable', () => {
    const b = 100_000;
    const nTarget = 240;
    const floor = b / nTarget;
    const atFloor = monthlyPayment(b, 0.0001 / 12, nTarget);
    const currentMonthlyPayment = (floor + atFloor) / 2;
    const result = solveTermShortening(
      { balance: b, currentMonthlyPayment, monthsRemaining: 360 },
      { targetRemainingYears: nTarget / 12 },
    );
    expect(result.rateSolverResult.kind).toBe('trivially_achievable');
  });

  it('canonical case C: normal range → solved', () => {
    const currentMonthlyPayment = monthlyPayment(300_000, 0.0675 / 12, 360);
    const result = solveTermShortening(
      { balance: 300_000, currentMonthlyPayment, monthsRemaining: 360 },
      { targetRemainingYears: 20 },
    );
    expect(result.rateSolverResult.kind).toBe('solved');
  });
});
