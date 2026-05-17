// Property-based tests for src/rate-solver.ts — the bisection rate solver
// (MATH.md §4). solveForRate inverts monthlyPayment over the monthly-rate
// band [0.01% annual, 20% annual], returning a discriminated union that
// covers all four §4 cases.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { solveForRate } from '../src/rate-solver.js';
import { monthlyPayment } from '../src/amortization.js';

// ---------- Generators ----------

/** Realistic loan balance in dollars. */
const balanceArb = fc.double({
  min: 1,
  max: 1e8,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * Balance restricted to [1000, 1e8] for the round-trip / monotonicity laws,
 * keeping the bisection float arithmetic well-conditioned.
 */
const wellConditionedBalanceArb = fc.double({
  min: 1_000,
  max: 1e8,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Loan term in months: 1 year to 40 years. */
const termArb = fc.integer({ min: 12, max: 480 });

/**
 * Monthly rate STRICTLY inside the bisection band (0.01%–20% annual), so a
 * solved round trip is guaranteed and the result is never a boundary case.
 */
const interiorRateArb = fc.double({
  min: 0.0002 / 12,
  max: 0.19 / 12,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * A lower interior rate, leaving headroom for a separating gap so the
 * monotonicity law compares two rates that are meaningfully distinct — i.e.
 * farther apart than the bisection tolerance (1e-10), which would otherwise
 * collapse them to the same solved rate.
 */
const lowerInteriorRateArb = fc.double({
  min: 0.0002 / 12,
  max: 0.18 / 12,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Separating gap between the two monotonicity rates. */
const rateGapArb = fc.double({
  min: 1e-5,
  max: 0.01 / 12,
  noNaN: true,
  noDefaultInfinity: true,
});

/** The 20%-annual rate ceiling used by the solver. */
const RATE_CEILING_MONTHLY = 0.2 / 12;

// ---------- §4 Input validation ----------

describe('solveForRate input validation', () => {
  it('throws when termMonths is not positive', () => {
    for (const n of [0, -1, -12, -360]) {
      expect(() => solveForRate(300_000, n, 2000)).toThrow();
    }
  });
});

// ---------- §4.1 infeasible_zero_rate ----------

describe('solveForRate §4.1 infeasible_zero_rate', () => {
  it('reports infeasible_zero_rate when the target is below the B/n floor', () => {
    fc.assert(
      fc.property(
        balanceArb,
        termArb,
        fc.double({ min: 0, max: 0.999, noNaN: true, noDefaultInfinity: true }),
        (b, n, frac) => {
          const floor = b / n;
          const target = frac * floor;
          // frac < 1 keeps target strictly below the floor.
          if (!(target < floor)) return true;
          const result = solveForRate(b, n, target);
          return (
            result.kind === 'infeasible_zero_rate' &&
            result.paymentFloor === floor
          );
        },
      ),
    );
  });

  it('a zero target for a positive balance is infeasible_zero_rate', () => {
    fc.assert(
      fc.property(balanceArb, termArb, (b, n) => {
        return solveForRate(b, n, 0).kind === 'infeasible_zero_rate';
      }),
    );
  });
});

// ---------- §4.2 requires_extreme_rate ----------

describe('solveForRate §4.2 requires_extreme_rate', () => {
  it('reports requires_extreme_rate when the target exceeds the 20% ceiling', () => {
    fc.assert(
      fc.property(balanceArb, termArb, (b, n) => {
        const ceilingPayment = monthlyPayment(b, RATE_CEILING_MONTHLY, n);
        const target = ceilingPayment + 1;
        return solveForRate(b, n, target).kind === 'requires_extreme_rate';
      }),
    );
  });
});

// ---------- §4.2 trivially_achievable ----------

describe('solveForRate §4.2 trivially_achievable', () => {
  it('reports trivially_achievable at the zero-rate floor B/n exactly', () => {
    fc.assert(
      fc.property(balanceArb, termArb, (b, n) => {
        return solveForRate(b, n, b / n).kind === 'trivially_achievable';
      }),
    );
  });
});

// ---------- §4.2 solved: the round-trip keystone ----------

describe('solveForRate §4.2 solved', () => {
  it('recovers the rate that produced a target payment', () => {
    fc.assert(
      fc.property(
        wellConditionedBalanceArb,
        termArb,
        interiorRateArb,
        (b, n, r) => {
          const target = monthlyPayment(b, r, n);
          const result = solveForRate(b, n, target);
          expect(result.kind).toBe('solved');
          if (result.kind !== 'solved') return false;
          expect(Math.abs(result.monthlyRate - r)).toBeLessThan(1e-8);
          const achieved = monthlyPayment(b, result.monthlyRate, n);
          return Math.abs(achieved - target) / target < 1e-6;
        },
      ),
    );
  });

  it('is monotonic: a lower target payment yields a lower solved rate', () => {
    fc.assert(
      fc.property(
        wellConditionedBalanceArb,
        termArb,
        lowerInteriorRateArb,
        rateGapArb,
        (b, n, r1, gap) => {
          // r1 < r2, both strictly inside the bisection band.
          const r2 = r1 + gap;
          const result1 = solveForRate(b, n, monthlyPayment(b, r1, n));
          const result2 = solveForRate(b, n, monthlyPayment(b, r2, n));
          expect(result1.kind).toBe('solved');
          expect(result2.kind).toBe('solved');
          if (result1.kind !== 'solved' || result2.kind !== 'solved') {
            return false;
          }
          return result1.monthlyRate < result2.monthlyRate;
        },
      ),
    );
  });

  it('converges within MAX_ITERATIONS (100)', () => {
    fc.assert(
      fc.property(
        wellConditionedBalanceArb,
        termArb,
        interiorRateArb,
        (b, n, r) => {
          const result = solveForRate(b, n, monthlyPayment(b, r, n));
          if (result.kind !== 'solved') return true;
          return result.iterations <= 100;
        },
      ),
    );
  });

  it('canonical examples (MATH.md §4 case partition)', () => {
    // §4.2 solved: a standard 30-year loan at 6.75% annual.
    const r = 0.0675 / 12;
    const target = monthlyPayment(300_000, r, 360);
    expect(target).toBeCloseTo(1945.79, 1);
    const solved = solveForRate(300_000, 360, target);
    expect(solved.kind).toBe('solved');
    if (solved.kind === 'solved') {
      expect(Math.abs(solved.monthlyRate - r)).toBeLessThan(1e-8);
    }

    // §4.1 infeasible_zero_rate: 300000/12 = 25000 exactly.
    const infeasible = solveForRate(300_000, 12, 20_000);
    expect(infeasible.kind).toBe('infeasible_zero_rate');
    if (infeasible.kind === 'infeasible_zero_rate') {
      expect(infeasible.paymentFloor).toBe(25_000);
    }

    // §4.2 requires_extreme_rate: $100k/mo is far above the 20% ceiling.
    expect(solveForRate(300_000, 360, 100_000).kind).toBe(
      'requires_extreme_rate',
    );

    // §4.2 trivially_achievable: target exactly at the zero-rate floor.
    expect(solveForRate(300_000, 360, 300_000 / 360).kind).toBe(
      'trivially_achievable',
    );
  });
});
