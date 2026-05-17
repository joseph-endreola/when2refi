// Totality property test for interpretCashOut. Covers both branches of
// CashOutResult ('ltv_exceeded' and 'rate_check'), and within rate_check the
// full §4 table plus the DSCR-breach reshaping of the ROW analysis.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { CashOutResult } from '@when2refi/math';
import { interpretCashOut } from '../interpretCashOut';
import {
  DSCR_CASH_FLOW_WARNING_THRESHOLD,
  DSCR_LOAN_ELIGIBILITY_THRESHOLD,
} from '@when2refi/math';
import {
  GOAL_OUTCOME_KINDS,
  dollarArb,
  rateSolverResultArb,
  signedDollarArb,
} from './arbitraries';

const dscrArb = fc.oneof(
  fc.constant(null),
  fc.double({ min: 0, max: 5, noNaN: true, noDefaultInfinity: true }),
);
const rowArb = fc.oneof(fc.constant(null), signedDollarArb);

const rowAnalysisArb = fc.record({
  before: fc.record({
    monthlyPayment: dollarArb,
    annualGrossRent: dollarArb,
    operatingExpenses: dollarArb,
    netOperatingIncome: signedDollarArb,
    annualDebtService: dollarArb,
    cashFlowAnnual: signedDollarArb,
    equity: signedDollarArb,
    debtServiceCoverage: dscrArb,
    returnOnWealth: rowArb,
  }),
  after: fc.oneof(
    fc.constant(null),
    fc.record({
      monthlyPayment: dollarArb,
      annualDebtService: dollarArb,
      cashFlowAnnual: signedDollarArb,
      equity: signedDollarArb,
      debtServiceCoverage: dscrArb,
      returnOnWealth: rowArb,
      redeployedReturn: signedDollarArb,
      totalReturnAfter: signedDollarArb,
    }),
  ),
  totalReturnDelta: fc.oneof(fc.constant(null), signedDollarArb),
});

const cashOutResultArb: fc.Arbitrary<CashOutResult> = fc.oneof(
  fc.record({
    kind: fc.constant('ltv_exceeded' as const),
    newBalance: dollarArb,
    newLtv: dollarArb,
    maxLtv: fc.constantFrom(0.75, 0.8),
    maxCashOut: dollarArb,
  }),
  fc.record({
    kind: fc.constant('rate_check' as const),
    newBalance: dollarArb,
    newLtv: dollarArb,
    maxLtv: fc.constantFrom(0.75, 0.8),
    rateSolverResult: rateSolverResultArb,
    equityRemaining: signedDollarArb,
    closingCost: dollarArb,
    rowAnalysis: fc.oneof(fc.constant(null), rowAnalysisArb),
  }),
);

describe('interpretCashOut', () => {
  it('is total over both CashOutResult branches and the §4 table', () => {
    fc.assert(
      fc.property(cashOutResultArb, (result) => {
        const outcome = interpretCashOut(result);
        expect(GOAL_OUTCOME_KINDS).toContain(outcome.kind);

        if (result.kind === 'ltv_exceeded') {
          expect(outcome.kind).toBe('infeasible');
          if (outcome.kind === 'infeasible') {
            expect(outcome.reason.kind).toBe('ltv_exceeded');
            if (outcome.reason.kind === 'ltv_exceeded') {
              expect(outcome.reason.maxCashOut).toBe(result.maxCashOut);
            }
          }
          return;
        }

        switch (result.rateSolverResult.kind) {
          case 'solved':
            expect(outcome.kind).toBe('achievable');
            break;
          case 'trivially_achievable':
            expect(outcome.kind).toBe('already_met');
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

        // DSCR breaches are computed from the post-refi DSCR.
        if (outcome.kind !== 'infeasible') {
          const row = outcome.display.rowAnalysis;
          if (row !== null) {
            const dscr =
              row.after === null ? null : row.after.debtServiceCoverage;
            if (dscr === null) {
              expect(row.dscrBreaches).toEqual({
                cashFlow: false,
                loanEligibility: false,
              });
            } else {
              expect(row.dscrBreaches.cashFlow).toBe(
                dscr < DSCR_CASH_FLOW_WARNING_THRESHOLD,
              );
              expect(row.dscrBreaches.loanEligibility).toBe(
                dscr < DSCR_LOAN_ELIGIBILITY_THRESHOLD,
              );
            }
          }
        }
      }),
    );
  });
});
