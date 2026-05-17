// Property tests for the shared display constructors in outcomes/displays.ts.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildTermResetWarning, computeDscrBreaches } from '../displays';

const monthsArb = fc.integer({ min: 0, max: 600 });
const deltaArb = fc.double({
  min: -1e7,
  max: 1e7,
  noNaN: true,
  noDefaultInfinity: true,
});

describe('buildTermResetWarning', () => {
  it('additionalMonths is exactly newTermMonths - remainingTermMonths', () => {
    fc.assert(
      fc.property(monthsArb, monthsArb, deltaArb, (newTerm, remaining, delta) => {
        const warning = buildTermResetWarning(true, newTerm, remaining, delta);
        expect(warning).not.toBeNull();
        if (warning === null) return;
        expect(warning.additionalMonths).toBe(newTerm - remaining);
        expect(warning.newTermMonths).toBe(newTerm);
        expect(warning.remainingTermMonths).toBe(remaining);
        expect(warning.totalInterestDelta).toBe(delta);
      }),
    );
  });

  it('returns null whenever isTermReset is false', () => {
    fc.assert(
      fc.property(monthsArb, monthsArb, deltaArb, (newTerm, remaining, delta) => {
        expect(buildTermResetWarning(false, newTerm, remaining, delta)).toBeNull();
      }),
    );
  });
});

describe('computeDscrBreaches', () => {
  it('cashFlow iff dscr < 1.00, loanEligibility iff dscr < 1.25', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 5, noNaN: true, noDefaultInfinity: true }),
        (dscr) => {
          const breaches = computeDscrBreaches(dscr);
          expect(breaches.cashFlow).toBe(dscr < 1.0);
          expect(breaches.loanEligibility).toBe(dscr < 1.25);
        },
      ),
    );
  });

  it('both flags are false when dscr is null', () => {
    expect(computeDscrBreaches(null)).toEqual({
      cashFlow: false,
      loanEligibility: false,
    });
  });
});
