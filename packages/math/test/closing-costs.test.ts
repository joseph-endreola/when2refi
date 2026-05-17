// Property-based tests for src/closing-costs.ts — the closing cost
// estimator (MATH.md §3). CC = B × ratio. UI-layer estimate only.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  closingCostEstimate,
  DEFAULT_CLOSING_COST_RATIO,
} from '../src/closing-costs.js';

// ---------- Generators ----------

/** Realistic loan balance in dollars. */
const balanceArb = fc.double({
  min: 0,
  max: 1e8,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Closing cost ratio: any fraction in [0, 1]. */
const ratioArb = fc.double({
  min: 0,
  max: 1,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Non-zero scaling factor for the linearity laws. */
const factorArb = fc.double({
  min: 0.001,
  max: 100,
  noNaN: true,
  noDefaultInfinity: true,
});

// ---------- §3 Closing Cost Estimate ----------

describe('closingCostEstimate', () => {
  it('is exactly B × ratio', () => {
    fc.assert(
      fc.property(balanceArb, ratioArb, (b, r) => {
        return closingCostEstimate(b, r) === b * r;
      }),
    );
  });

  it('is linear in the balance: scaling B by k scales the result by k', () => {
    fc.assert(
      fc.property(balanceArb, ratioArb, factorArb, (b, r, k) => {
        const scaled = closingCostEstimate(b * k, r);
        const expected = k * closingCostEstimate(b, r);
        return Math.abs(scaled - expected) <= 1e-9 * Math.abs(expected) + 1e-9;
      }),
    );
  });

  it('is linear in the ratio: scaling r by k scales the result by k', () => {
    fc.assert(
      fc.property(balanceArb, ratioArb, factorArb, (b, r, k) => {
        const scaled = closingCostEstimate(b, r * k);
        const expected = k * closingCostEstimate(b, r);
        return Math.abs(scaled - expected) <= 1e-9 * Math.abs(expected) + 1e-9;
      }),
    );
  });

  it('is zero for a zero balance', () => {
    fc.assert(
      fc.property(ratioArb, (r) => {
        return closingCostEstimate(0, r) === 0;
      }),
    );
  });

  it('is zero for a zero ratio', () => {
    fc.assert(
      fc.property(balanceArb, (b) => {
        return closingCostEstimate(b, 0) === 0;
      }),
    );
  });

  it('defaults to DEFAULT_CLOSING_COST_RATIO when no ratio is given', () => {
    fc.assert(
      fc.property(balanceArb, (b) => {
        return (
          closingCostEstimate(b) ===
          closingCostEstimate(b, DEFAULT_CLOSING_COST_RATIO)
        );
      }),
    );
  });

  it('is non-negative for a non-negative balance and ratio', () => {
    fc.assert(
      fc.property(balanceArb, ratioArb, (b, r) => {
        return closingCostEstimate(b, r) >= 0;
      }),
    );
  });

  it('canonical examples (MATH.md §3)', () => {
    expect(DEFAULT_CLOSING_COST_RATIO).toBe(0.025);
    expect(closingCostEstimate(300_000)).toBe(7500);
    expect(closingCostEstimate(300_000, 0.02)).toBe(6000);
    expect(closingCostEstimate(300_000, 0.03)).toBe(9000);
  });
});
