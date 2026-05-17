// Property-based tests for src/units.ts — the storage ↔ working unit
// boundary (MATH.md §1).

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  cents,
  bps,
  centsToDollars,
  dollarsToCents,
  bpsToAnnualRate,
  annualRateToBps,
  bpsToMonthlyRate,
  monthlyRateToBps,
} from '../src/units.js';

describe('smart constructors', () => {
  it('cents rejects non-integers', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e9, max: 1e9, noNaN: true, noDefaultInfinity: true }),
        (n) => {
          if (Number.isInteger(n)) return true;
          expect(() => cents(n)).toThrow();
          return true;
        },
      ),
    );
  });

  it('bps rejects non-integers', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        (n) => {
          if (Number.isInteger(n)) return true;
          expect(() => bps(n)).toThrow();
          return true;
        },
      ),
    );
  });

  it('cents and bps accept any integer', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e9, max: 1e9 }), (n) => {
        expect(() => cents(n)).not.toThrow();
        expect(() => bps(n)).not.toThrow();
        return true;
      }),
    );
  });

  it('cents rejects NaN and Infinity', () => {
    expect(() => cents(Number.NaN)).toThrow();
    expect(() => cents(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => bps(Number.NaN)).toThrow();
  });
});

describe('cents ↔ dollars', () => {
  it('cents → dollars → cents is identity for any integer cent value', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), (n) => {
        const roundTrip = dollarsToCents(centsToDollars(cents(n)));
        return (roundTrip as number) === n;
      }),
    );
  });

  it('centsToDollars is exactly cents / 100', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), (n) => {
        return centsToDollars(cents(n)) === n / 100;
      }),
    );
  });

  it('dollarsToCents always produces an integer', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e7, max: 1e7, noNaN: true, noDefaultInfinity: true }),
        (d) => Number.isInteger(dollarsToCents(d) as number),
      ),
    );
  });

  it('dollarsToCents rounds to the nearest cent', () => {
    expect(dollarsToCents(1.004) as number).toBe(100);
    expect(dollarsToCents(1.006) as number).toBe(101);
  });

  it('canonical example: 32_500_000 cents ↔ $325000', () => {
    expect(centsToDollars(cents(32_500_000))).toBe(325000);
    expect(dollarsToCents(325000) as number).toBe(32_500_000);
  });
});

describe('bps ↔ annual rate', () => {
  it('bps → annual rate → bps is identity for any integer bps value', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), (n) => {
        const roundTrip = annualRateToBps(bpsToAnnualRate(bps(n)));
        return (roundTrip as number) === n;
      }),
    );
  });

  it('annualRateToBps always produces an integer', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10, max: 10, noNaN: true, noDefaultInfinity: true }),
        (r) => Number.isInteger(annualRateToBps(r) as number),
      ),
    );
  });

  it('canonical example: 675 bps → 0.0675 annual', () => {
    expect(bpsToAnnualRate(bps(675))).toBeCloseTo(0.0675, 12);
    expect(annualRateToBps(0.0675) as number).toBe(675);
  });
});

describe('bps ↔ monthly rate', () => {
  it('bps → monthly rate → bps (annual) is identity for any integer bps value', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), (n) => {
        const roundTrip = monthlyRateToBps(bpsToMonthlyRate(bps(n)));
        return (roundTrip as number) === n;
      }),
    );
  });

  it('monthlyRateToBps always produces an integer', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
        (m) => Number.isInteger(monthlyRateToBps(m) as number),
      ),
    );
  });

  it('monthly rate is the annual rate divided by 12', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), (n) => {
        const b = bps(n);
        return bpsToMonthlyRate(b) === bpsToAnnualRate(b) / 12;
      }),
    );
  });

  it('canonical example: 675 annual bps → 0.005625 monthly', () => {
    expect(bpsToMonthlyRate(bps(675))).toBeCloseTo(0.005625, 14);
  });
});
