// Property-based tests for src/amortization.ts — the amortization engine
// (MATH.md §2). Inputs are working units: dollars, decimal monthly rate,
// integer months.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  monthlyPayment,
  monthsBetween,
  remainingTerm,
  remainingInterest,
  balanceAtMonth,
  annualInterest,
} from '../src/amortization.js';

// ---------- Generators ----------

/** Realistic loan balance in dollars. */
const balanceArb = fc.double({
  min: 1_000,
  max: 5_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Monthly rate within the solver's realistic band (0.01%–20% annual). */
const monthlyRateArb = fc.double({
  min: 0.0001 / 12,
  max: 0.2 / 12,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Loan term in months: 1 month to 40 years. */
const termArb = fc.integer({ min: 1, max: 480 });

/** A YYYY-MM-DD date with a day in 1–28 so month arithmetic stays clean. */
const safeDateArb = fc.record({
  y: fc.integer({ min: 1970, max: 2200 }),
  m: fc.integer({ min: 1, max: 12 }),
  d: fc.integer({ min: 1, max: 28 }),
});

const pad = (n: number): string => String(n).padStart(2, '0');
const fmt = (y: number, m: number, d: number): string =>
  `${y}-${pad(m)}-${pad(d)}`;

/** Add k months to (y, m), returning the normalized [year, month]. */
const addMonths = (y: number, m: number, k: number): [number, number] => {
  const total = y * 12 + (m - 1) + k;
  return [Math.floor(total / 12), (total % 12) + 1];
};

// ---------- §2.1 Standard Monthly Payment ----------

describe('monthlyPayment', () => {
  it('throws when termMonths is not positive', () => {
    fc.assert(
      fc.property(
        balanceArb,
        monthlyRateArb,
        fc.integer({ min: -100, max: 0 }),
        (b, r, n) => {
          expect(() => monthlyPayment(b, r, n)).toThrow();
          return true;
        },
      ),
    );
  });

  it('at r_m = 0 the payment is exactly B / n', () => {
    fc.assert(
      fc.property(balanceArb, termArb, (b, n) => {
        return monthlyPayment(b, 0, n) === b / n;
      }),
    );
  });

  it('is positive for a positive balance, rate, and term', () => {
    fc.assert(
      fc.property(balanceArb, monthlyRateArb, termArb, (b, r, n) => {
        return monthlyPayment(b, r, n) > 0;
      }),
    );
  });

  it('is never below the zero-rate floor B / n', () => {
    fc.assert(
      fc.property(balanceArb, monthlyRateArb, termArb, (b, r, n) => {
        return monthlyPayment(b, r, n) >= b / n - 1e-6;
      }),
    );
  });

  it('total scheduled payments cover at least the principal', () => {
    fc.assert(
      fc.property(balanceArb, monthlyRateArb, termArb, (b, r, n) => {
        return monthlyPayment(b, r, n) * n >= b - 1e-6;
      }),
    );
  });

  it('is monotonically non-decreasing in the rate', () => {
    fc.assert(
      fc.property(
        balanceArb,
        monthlyRateArb,
        monthlyRateArb,
        termArb,
        (b, r1, r2, n) => {
          const [lo, hi] = r1 <= r2 ? [r1, r2] : [r2, r1];
          return monthlyPayment(b, lo, n) <= monthlyPayment(b, hi, n) + 1e-9;
        },
      ),
    );
  });
});

// ---------- §2.2 Remaining Term ----------

describe('monthsBetween', () => {
  it('throws on a non-numeric or malformed date', () => {
    expect(() => monthsBetween('not-a-date', '2020-01-01')).toThrow();
    expect(() => monthsBetween('2020-01-01', 'xx-yy-zz')).toThrow();
  });

  it('is zero for identical dates', () => {
    fc.assert(
      fc.property(safeDateArb, ({ y, m, d }) => {
        return monthsBetween(fmt(y, m, d), fmt(y, m, d)) === 0;
      }),
    );
  });

  it('is never negative', () => {
    fc.assert(
      fc.property(safeDateArb, safeDateArb, (a, b) => {
        return monthsBetween(fmt(a.y, a.m, a.d), fmt(b.y, b.m, b.d)) >= 0;
      }),
    );
  });

  it('is zero when the end date precedes the start date', () => {
    fc.assert(
      fc.property(
        safeDateArb,
        fc.integer({ min: 1, max: 600 }),
        ({ y, m, d }, k) => {
          const [ey, em] = addMonths(y, m, k);
          // start is the later date, end is the earlier date → 0
          return monthsBetween(fmt(ey, em, d), fmt(y, m, d)) === 0;
        },
      ),
    );
  });

  it('recovers exactly k when k whole months are added (same day)', () => {
    fc.assert(
      fc.property(
        safeDateArb,
        fc.integer({ min: 0, max: 1200 }),
        ({ y, m, d }, k) => {
          const [ey, em] = addMonths(y, m, k);
          return monthsBetween(fmt(y, m, d), fmt(ey, em, d)) === k;
        },
      ),
    );
  });

  it('floors down when the end day is earlier in the month than the start day', () => {
    // 2020-01-20 → 2020-03-10: 2 calendar months apart, but day floors to 1.
    expect(monthsBetween('2020-01-20', '2020-03-10')).toBe(1);
    expect(monthsBetween('2020-01-10', '2020-03-20')).toBe(2);
  });
});

describe('remainingTerm', () => {
  it('active branch: elapsed + remaining equals the original term', () => {
    fc.assert(
      fc.property(safeDateArb, fc.integer({ min: 1, max: 600 }), safeDateArb, (start, term, today) => {
        const result = remainingTerm(
          fmt(start.y, start.m, start.d),
          term,
          fmt(today.y, today.m, today.d),
        );
        if (result.kind === 'active') {
          expect(result.monthsRemaining).toBeGreaterThan(0);
          return result.monthsElapsed + result.monthsRemaining === term;
        }
        return true;
      }),
    );
  });

  it('classifies as matured exactly when elapsed >= the original term', () => {
    fc.assert(
      fc.property(safeDateArb, fc.integer({ min: 1, max: 600 }), safeDateArb, (start, term, today) => {
        const startISO = fmt(start.y, start.m, start.d);
        const todayISO = fmt(today.y, today.m, today.d);
        const elapsed = monthsBetween(startISO, todayISO);
        const result = remainingTerm(startISO, term, todayISO);
        return result.kind === (elapsed >= term ? 'matured' : 'active');
      }),
    );
  });

  it('monthsElapsed always matches monthsBetween(start, today)', () => {
    fc.assert(
      fc.property(safeDateArb, fc.integer({ min: 1, max: 600 }), safeDateArb, (start, term, today) => {
        const startISO = fmt(start.y, start.m, start.d);
        const todayISO = fmt(today.y, today.m, today.d);
        const result = remainingTerm(startISO, term, todayISO);
        return result.monthsElapsed === monthsBetween(startISO, todayISO);
      }),
    );
  });
});

// ---------- §2.3 Remaining Interest ----------

describe('remainingInterest', () => {
  it('equals P × n − B', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        termArb,
        balanceArb,
        (p, n, b) => {
          return remainingInterest(p, n, b) === p * n - b;
        },
      ),
    );
  });

  it('is non-negative for a self-consistent performing loan', () => {
    fc.assert(
      fc.property(balanceArb, monthlyRateArb, termArb, (b, r, n) => {
        const p = monthlyPayment(b, r, n);
        return remainingInterest(p, n, b) >= -1e-6;
      }),
    );
  });

  it('is zero at r_m = 0 for a self-consistent loan', () => {
    fc.assert(
      fc.property(balanceArb, termArb, (b, n) => {
        const p = monthlyPayment(b, 0, n);
        return Math.abs(remainingInterest(p, n, b)) < 1e-6;
      }),
    );
  });
});

// ---------- §2.4 Balance at Month k ----------

describe('balanceAtMonth', () => {
  it('returns the original balance for k <= 0', () => {
    fc.assert(
      fc.property(
        balanceArb,
        monthlyRateArb,
        fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: -50, max: 0 }),
        (b, r, p, k) => balanceAtMonth(b, r, p, k) === b,
      ),
    );
  });

  it('never returns a negative balance', () => {
    fc.assert(
      fc.property(
        balanceArb,
        monthlyRateArb,
        fc.double({ min: 0, max: 200_000, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 0, max: 1000 }),
        (b, r, p, k) => balanceAtMonth(b, r, p, k) >= 0,
      ),
    );
  });

  it('at r_m = 0 is the straight-line B − P × k, clamped at 0', () => {
    fc.assert(
      fc.property(
        balanceArb,
        fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 0, max: 1000 }),
        (b, p, k) => balanceAtMonth(b, 0, p, k) === Math.max(0, b - p * k),
      ),
    );
  });

  it('is monotonically non-increasing in k for a scheduled-payment loan', () => {
    fc.assert(
      fc.property(balanceArb, monthlyRateArb, termArb, fc.integer({ min: 0, max: 480 }), (b, r, n, k) => {
        const p = monthlyPayment(b, r, n);
        return balanceAtMonth(b, r, p, k + 1) <= balanceAtMonth(b, r, p, k) + 1e-6;
      }),
    );
  });

  it('full amortization: balance after n scheduled payments is ~0', () => {
    fc.assert(
      fc.property(balanceArb, monthlyRateArb, termArb, (b, r, n) => {
        const p = monthlyPayment(b, r, n);
        const end = balanceAtMonth(b, r, p, n);
        return end <= Math.max(1e-3, b * 1e-6);
      }),
    );
  });
});

// ---------- §2.5 Annual Interest ----------

describe('annualInterest', () => {
  it('is zero when the monthly rate is zero', () => {
    fc.assert(
      fc.property(
        balanceArb,
        fc.double({ min: 0, max: 100_000, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 0, max: 480 }),
        (b, p, start) => annualInterest(b, 0, p, start) === 0,
      ),
    );
  });

  it('is non-negative', () => {
    fc.assert(
      fc.property(balanceArb, monthlyRateArb, termArb, (b, r, n) => {
        const p = monthlyPayment(b, r, n);
        return annualInterest(b, r, p, 0) >= 0;
      }),
    );
  });

  it('does not exceed the B × r_m × 12 approximation (documented overestimate)', () => {
    fc.assert(
      fc.property(balanceArb, monthlyRateArb, termArb, (b, r, n) => {
        const p = monthlyPayment(b, r, n);
        return annualInterest(b, r, p, 0) <= b * r * 12 + 1e-6;
      }),
    );
  });

  it('a later 12-month window charges no more interest than an earlier one', () => {
    fc.assert(
      fc.property(balanceArb, monthlyRateArb, termArb, (b, r, n) => {
        const p = monthlyPayment(b, r, n);
        return annualInterest(b, r, p, 12) <= annualInterest(b, r, p, 0) + 1e-6;
      }),
    );
  });

  it('equals the sum of r_m × balanceAtMonth over the 12-month window', () => {
    fc.assert(
      fc.property(balanceArb, monthlyRateArb, termArb, (b, r, n) => {
        const p = monthlyPayment(b, r, n);
        let manual = 0;
        for (let k = 0; k < 12; k++) {
          manual += r * balanceAtMonth(b, r, p, k);
        }
        return Math.abs(annualInterest(b, r, p, 0) - manual) < 1e-9;
      }),
    );
  });
});
