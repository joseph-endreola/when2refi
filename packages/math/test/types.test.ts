import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  cents,
  bps,
  months,
  dollars,
  centsToDollars,
  dollarsToCents,
  bpsToDecimalRate,
  decimalRateToBps,
  annualToMonthly,
  monthlyToAnnual,
  unwrapCents,
  unwrapBps,
  unwrapDollars,
  decimalRate,
} from '../src/types.js';

describe('smart constructors reject invalid input', () => {
  it('cents rejects non-integers', () => {
    expect(() => cents(1.5)).toThrow(RangeError);
  });

  it('cents rejects NaN and Infinity', () => {
    expect(() => cents(Number.NaN)).toThrow(RangeError);
    expect(() => cents(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('bps rejects non-integers', () => {
    expect(() => bps(675.5)).toThrow(RangeError);
  });

  it('months rejects negative values', () => {
    expect(() => months(-1)).toThrow(RangeError);
  });

  it('dollars accepts any finite number, including negative', () => {
    expect(() => dollars(-100.25)).not.toThrow();
  });
});

describe('cents <-> dollars round-trips', () => {
  it('cents → dollars → cents is identity for any integer cent value', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        (n) => {
          const c = cents(n);
          const roundTrip = dollarsToCents(centsToDollars(c));
          return unwrapCents(roundTrip) === n;
        },
      ),
    );
  });
});

describe('bps <-> decimalRate round-trips', () => {
  it('bps → decimalRate → bps is identity for any integer bps value', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000, max: 100_000 }),
        (n) => {
          const b = bps(n);
          const roundTrip = decimalRateToBps(bpsToDecimalRate(b));
          return unwrapBps(roundTrip) === n;
        },
      ),
    );
  });

  it('675 bps converts to exactly 0.0675 decimal', () => {
    expect(bpsToDecimalRate(bps(675))).toBeCloseTo(0.0675, 10);
  });
});

describe('annual <-> monthly rate round-trips', () => {
  it('annual → monthly → annual is identity within float precision', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.2, noNaN: true }),
        (r) => {
          const annual = decimalRate(r);
          const roundTrip = monthlyToAnnual(annualToMonthly(annual));
          return Math.abs((roundTrip as number) - r) < 1e-12;
        },
      ),
    );
  });
});

describe('canonical conversion examples from MATH.md', () => {
  it('$1234.56 → 123456 cents', () => {
    expect(unwrapCents(dollarsToCents(dollars(1234.56)))).toBe(123456);
  });

  it('123456 cents → $1234.56', () => {
    expect(unwrapDollars(centsToDollars(cents(123456)))).toBe(1234.56);
  });

  it('6.75% annual → 0.005625 monthly', () => {
    const m = annualToMonthly(bpsToDecimalRate(bps(675)));
    expect(m as number).toBeCloseTo(0.005625, 12);
  });
});
