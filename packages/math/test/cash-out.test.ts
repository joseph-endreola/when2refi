// Property-based tests for src/cash-out.ts — the §5.5 cash-out solver.
// solveCashOut is a two-branch discriminated union: 'ltv_exceeded' when
// the requested cash-out breaches maxLtv, 'rate_check' otherwise (with an
// optional ROW analysis when investment inputs are supplied).

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { monthlyPayment } from '../src/amortization.js';
import {
  DEFAULT_CLOSING_COST_RATIO,
  closingCostEstimate,
} from '../src/closing-costs.js';
import { solveForRate } from '../src/rate-solver.js';
import type { RateSolverResult } from '../src/rate-solver.js';
import { DEFAULT_OPERATING_EXPENSE_RATE } from '../src/investment-metrics.js';
import { computeIncomeMetrics } from '../src/investment-metrics.js';
import {
  MAX_LTV_PRIMARY,
  MAX_LTV_INVESTMENT,
  solveCashOut,
} from '../src/cash-out.js';
import type {
  CashOutContext,
  CashOutInvestmentInputs,
} from '../src/cash-out.js';

// ---------- Generators ----------

const propertyValueArb = fc.double({
  min: 100_000,
  max: 1e7,
  noNaN: true,
  noDefaultInfinity: true,
});

const balanceArb = fc.double({
  min: 0,
  max: 1e7,
  noNaN: true,
  noDefaultInfinity: true,
});

const currentMonthlyPaymentArb = fc.double({
  min: 0,
  max: 1e5,
  noNaN: true,
  noDefaultInfinity: true,
});

const newTermArb = fc.constantFrom(180, 240, 360);

const closingCostRatioArb = fc.double({
  min: 0,
  max: 0.1,
  noNaN: true,
  noDefaultInfinity: true,
});

const maxLtvArb = fc.double({
  min: 0.5,
  max: 1.0,
  noNaN: true,
  noDefaultInfinity: true,
});

const cashOutAmountArb = fc.double({
  min: 0.01,
  max: 1e7,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Investment inputs with operatingExpenseRate sometimes absent. */
const investmentInputsArb: fc.Arbitrary<CashOutInvestmentInputs> = fc.record(
  {
    monthlyGrossRent: fc.double({
      min: 100,
      max: 1e5,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    operatingExpenseRate: fc.double({
      min: 0,
      max: 1,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    assumedReturnRate: fc.double({
      min: 0,
      max: 0.3,
      noNaN: true,
      noDefaultInfinity: true,
    }),
  },
  { requiredKeys: ['monthlyGrossRent', 'assumedReturnRate'] },
);

/** General context: closingCostRatio and investmentInputs sometimes absent. */
const contextArb: fc.Arbitrary<CashOutContext> = fc.record(
  {
    balance: balanceArb,
    propertyValue: propertyValueArb,
    currentMonthlyPayment: currentMonthlyPaymentArb,
    newTermMonths: newTermArb,
    closingCostRatio: closingCostRatioArb,
    maxLtv: maxLtvArb,
    investmentInputs: investmentInputsArb,
  },
  {
    requiredKeys: [
      'balance',
      'propertyValue',
      'currentMonthlyPayment',
      'newTermMonths',
      'maxLtv',
    ],
  },
);

/** Context with investmentInputs always present (closingCostRatio optional). */
const investmentContextArb: fc.Arbitrary<CashOutContext> = fc.record(
  {
    balance: balanceArb,
    propertyValue: propertyValueArb,
    currentMonthlyPayment: currentMonthlyPaymentArb,
    newTermMonths: newTermArb,
    closingCostRatio: closingCostRatioArb,
    maxLtv: maxLtvArb,
    investmentInputs: investmentInputsArb,
  },
  {
    requiredKeys: [
      'balance',
      'propertyValue',
      'currentMonthlyPayment',
      'newTermMonths',
      'maxLtv',
      'investmentInputs',
    ],
  },
);

/** Context with no optional keys, for the default-ratio equivalence test. */
const baseContextArb = fc.record({
  balance: balanceArb,
  propertyValue: propertyValueArb,
  currentMonthlyPayment: currentMonthlyPaymentArb,
  newTermMonths: newTermArb,
  maxLtv: maxLtvArb,
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

// Round-trip / ROW-solved construction: a rate that the bisection band
// strictly contains, so solveForRate is guaranteed to return 'solved'.
const roundTripPropertyValueArb = fc.double({
  min: 200_000,
  max: 5_000_000,
  noNaN: true,
  noDefaultInfinity: true,
});
/** newBalance as a fraction of propertyValue, well below either LTV cap. */
const roundTripFractionArb = fc.double({
  min: 0.25,
  max: 0.7,
  noNaN: true,
  noDefaultInfinity: true,
});
const roundTripRateArb = fc.double({
  min: 0.001 / 12,
  max: 0.1 / 12,
  noNaN: true,
  noDefaultInfinity: true,
});

// ---------- Input validation ----------

describe('solveCashOut input validation', () => {
  it('throws on a non-positive cashOutAmount', () => {
    for (const cashOutAmount of [0, -1, -100]) {
      expect(() =>
        solveCashOut(
          {
            balance: 100_000,
            propertyValue: 500_000,
            currentMonthlyPayment: 2000,
            newTermMonths: 360,
            maxLtv: MAX_LTV_PRIMARY,
          },
          { cashOutAmount },
        ),
      ).toThrow();
    }
  });
});

// ---------- Branch discrimination ----------

describe('solveCashOut branch discrimination', () => {
  it("is 'ltv_exceeded' exactly when newLtv strictly exceeds maxLtv", () => {
    fc.assert(
      fc.property(contextArb, cashOutAmountArb, (ctx, cashOutAmount) => {
        const result = solveCashOut(ctx, { cashOutAmount });
        const newLtv = (ctx.balance + cashOutAmount) / ctx.propertyValue;
        const expected = newLtv > ctx.maxLtv ? 'ltv_exceeded' : 'rate_check';
        return result.kind === expected;
      }),
    );
  });

  it('boundary newLtv === maxLtv lands in rate_check', () => {
    // newBalance 400_000 / propertyValue 500_000 = 0.80 exactly = maxLtv.
    const result = solveCashOut(
      {
        balance: 100_000,
        propertyValue: 500_000,
        currentMonthlyPayment: 2000,
        newTermMonths: 360,
        maxLtv: 0.8,
      },
      { cashOutAmount: 300_000 },
    );
    expect(result.kind).toBe('rate_check');
  });
});

// ---------- 'ltv_exceeded' branch ----------

describe("solveCashOut 'ltv_exceeded' branch", () => {
  it('display values match the §5.5 formulas', () => {
    fc.assert(
      fc.property(contextArb, cashOutAmountArb, (ctx, cashOutAmount) => {
        const result = solveCashOut(ctx, { cashOutAmount });
        if (result.kind !== 'ltv_exceeded') return true;
        expect(result.newBalance).toBe(ctx.balance + cashOutAmount);
        expect(result.newLtv).toBe(result.newBalance / ctx.propertyValue);
        expect(result.maxLtv).toBe(ctx.maxLtv);
        expect(result.maxCashOut).toBe(
          Math.max(0, ctx.propertyValue * ctx.maxLtv - ctx.balance),
        );
        return true;
      }),
    );
  });

  it('canonical: already over the cap yields maxCashOut clamped at 0', () => {
    fc.assert(
      fc.property(cashOutAmountArb, (cashOutAmount) => {
        const result = solveCashOut(
          {
            balance: 450_000,
            propertyValue: 500_000,
            currentMonthlyPayment: 2000,
            newTermMonths: 360,
            maxLtv: 0.8,
          },
          { cashOutAmount },
        );
        expect(result.kind).toBe('ltv_exceeded');
        if (result.kind !== 'ltv_exceeded') return false;
        // Raw maxCashOut = 500_000 * 0.80 - 450_000 = -50_000 => clamped.
        return result.maxCashOut === 0;
      }),
    );
  });
});

// ---------- 'rate_check' branch ----------

describe("solveCashOut 'rate_check' branch", () => {
  it('display values match the §5.5 formulas', () => {
    fc.assert(
      fc.property(contextArb, cashOutAmountArb, (ctx, cashOutAmount) => {
        const result = solveCashOut(ctx, { cashOutAmount });
        if (result.kind !== 'rate_check') return true;
        expect(result.newBalance).toBe(ctx.balance + cashOutAmount);
        expect(result.newLtv).toBe(result.newBalance / ctx.propertyValue);
        expect(result.newLtv).toBeLessThanOrEqual(ctx.maxLtv);
        expect(result.equityRemaining).toBe(
          ctx.propertyValue - result.newBalance,
        );
        expect(result.closingCost).toBe(
          closingCostEstimate(
            result.newBalance,
            ctx.closingCostRatio ?? DEFAULT_CLOSING_COST_RATIO,
          ),
        );
        return true;
      }),
    );
  });

  it('delegates to solveForRate on (newBalance, newTermMonths, currentMonthlyPayment)', () => {
    fc.assert(
      fc.property(contextArb, cashOutAmountArb, (ctx, cashOutAmount) => {
        const result = solveCashOut(ctx, { cashOutAmount });
        if (result.kind !== 'rate_check') return true;
        const direct = solveForRate(
          result.newBalance,
          ctx.newTermMonths,
          ctx.currentMonthlyPayment,
        );
        return sameRateSolverResult(result.rateSolverResult, direct);
      }),
    );
  });

  it('omitting closingCostRatio matches an explicit default', () => {
    fc.assert(
      fc.property(baseContextArb, cashOutAmountArb, (base, cashOutAmount) => {
        const r1 = solveCashOut(base, { cashOutAmount });
        const r2 = solveCashOut(
          { ...base, closingCostRatio: DEFAULT_CLOSING_COST_RATIO },
          { cashOutAmount },
        );
        if (r1.kind === 'rate_check' && r2.kind === 'rate_check') {
          expect(r1.closingCost).toBe(r2.closingCost);
        }
        return true;
      }),
    );
  });
});

// ---------- Round-trip keystone ----------

describe('solveCashOut round-trip keystone', () => {
  it('recovers the rate behind a payment-neutral cash-out', () => {
    fc.assert(
      fc.property(
        roundTripPropertyValueArb,
        roundTripFractionArb,
        roundTripRateArb,
        newTermArb,
        (propertyValue, fraction, rTarget, n) => {
          const newBalance = propertyValue * fraction;
          const currentMonthlyPayment = monthlyPayment(newBalance, rTarget, n);
          const balance = newBalance * 0.6;
          const cashOutAmount = newBalance - balance;
          const result = solveCashOut(
            {
              balance,
              propertyValue,
              currentMonthlyPayment,
              newTermMonths: n,
              maxLtv: MAX_LTV_PRIMARY,
            },
            { cashOutAmount },
          );
          expect(result.kind).toBe('rate_check');
          if (result.kind !== 'rate_check') return false;
          expect(result.rateSolverResult.kind).toBe('solved');
          if (result.rateSolverResult.kind !== 'solved') return false;
          return Math.abs(result.rateSolverResult.monthlyRate - rTarget) < 1e-8;
        },
      ),
    );
  });
});

// ---------- ROW analysis structure ----------

describe('solveCashOut ROW analysis structure', () => {
  it('rowAnalysis is null when investmentInputs is absent', () => {
    fc.assert(
      fc.property(contextArb, cashOutAmountArb, (ctx, cashOutAmount) => {
        if (ctx.investmentInputs !== undefined) return true;
        const result = solveCashOut(ctx, { cashOutAmount });
        if (result.kind !== 'rate_check') return true;
        return result.rowAnalysis === null;
      }),
    );
  });

  it('rowAnalysis is fully populated when rate is solved', () => {
    fc.assert(
      fc.property(
        roundTripPropertyValueArb,
        roundTripFractionArb,
        roundTripRateArb,
        newTermArb,
        investmentInputsArb,
        (propertyValue, fraction, rTarget, n, investmentInputs) => {
          const newBalance = propertyValue * fraction;
          const currentMonthlyPayment = monthlyPayment(newBalance, rTarget, n);
          const balance = newBalance * 0.6;
          const result = solveCashOut(
            {
              balance,
              propertyValue,
              currentMonthlyPayment,
              newTermMonths: n,
              maxLtv: MAX_LTV_PRIMARY,
              investmentInputs,
            },
            { cashOutAmount: newBalance - balance },
          );
          if (result.kind !== 'rate_check') return false;
          if (result.rateSolverResult.kind !== 'solved') return false;
          const row = result.rowAnalysis;
          return (
            row !== null &&
            row.after !== null &&
            row.totalReturnDelta !== null
          );
        },
      ),
    );
  });

  it('rowAnalysis.after is null when the rate is not solved', () => {
    // currentMonthlyPayment 100 << newBalance/n (600_000/360 = 1666.67):
    // the rate solver returns infeasible_zero_rate, so there is no after.
    const result = solveCashOut(
      {
        balance: 100_000,
        propertyValue: 1_000_000,
        currentMonthlyPayment: 100,
        newTermMonths: 360,
        maxLtv: MAX_LTV_PRIMARY,
        investmentInputs: { monthlyGrossRent: 4000, assumedReturnRate: 0.08 },
      },
      { cashOutAmount: 500_000 },
    );
    expect(result.kind).toBe('rate_check');
    if (result.kind !== 'rate_check') return;
    expect(result.rateSolverResult.kind).toBe('infeasible_zero_rate');
    expect(result.rowAnalysis).not.toBeNull();
    expect(result.rowAnalysis?.before).not.toBeNull();
    expect(result.rowAnalysis?.after).toBeNull();
    expect(result.rowAnalysis?.totalReturnDelta).toBeNull();
  });
});

// ---------- ROW analysis display laws ----------

describe('solveCashOut ROW analysis display laws', () => {
  it('before and after snapshots match the §5.5 formulas', () => {
    fc.assert(
      fc.property(
        roundTripPropertyValueArb,
        roundTripFractionArb,
        roundTripRateArb,
        newTermArb,
        investmentInputsArb,
        (propertyValue, fraction, rTarget, n, inv) => {
          const newBalance = propertyValue * fraction;
          const currentMonthlyPayment = monthlyPayment(newBalance, rTarget, n);
          const balance = newBalance * 0.6;
          const cashOutAmount = newBalance - balance;
          const result = solveCashOut(
            {
              balance,
              propertyValue,
              currentMonthlyPayment,
              newTermMonths: n,
              maxLtv: MAX_LTV_PRIMARY,
              investmentInputs: inv,
            },
            { cashOutAmount },
          );
          if (result.kind !== 'rate_check') return false;
          const row = result.rowAnalysis;
          if (row === null || row.after === null) return false;
          if (result.rateSolverResult.kind !== 'solved') return false;

          const rate = inv.operatingExpenseRate ?? DEFAULT_OPERATING_EXPENSE_RATE;
          const { before, after } = row;

          // Before snapshot.
          expect(before.monthlyPayment).toBe(currentMonthlyPayment);
          expect(before.annualGrossRent).toBe(inv.monthlyGrossRent * 12);
          expect(before.operatingExpenses).toBe(before.annualGrossRent * rate);
          expect(before.netOperatingIncome).toBe(
            before.annualGrossRent - before.operatingExpenses,
          );
          expect(before.annualDebtService).toBe(currentMonthlyPayment * 12);
          expect(before.cashFlowAnnual).toBe(
            before.netOperatingIncome - before.annualDebtService,
          );
          expect(before.equity).toBe(propertyValue - balance);

          // After snapshot.
          expect(after.monthlyPayment).toBe(
            monthlyPayment(newBalance, result.rateSolverResult.monthlyRate, n),
          );
          expect(after.annualDebtService).toBe(after.monthlyPayment * 12);
          expect(after.cashFlowAnnual).toBe(
            before.netOperatingIncome - after.annualDebtService,
          );
          expect(after.equity).toBe(propertyValue - newBalance);
          expect(after.redeployedReturn).toBe(
            cashOutAmount * inv.assumedReturnRate,
          );
          expect(after.totalReturnAfter).toBe(
            after.cashFlowAnnual + after.redeployedReturn,
          );
          expect(row.totalReturnDelta).toBe(
            after.totalReturnAfter - before.cashFlowAnnual,
          );
          return true;
        },
      ),
    );
  });
});

// ---------- ROW null mappings ----------

describe('solveCashOut ROW null mappings', () => {
  it('DSCR is null iff debt service is zero; ROW is null iff equity is non-positive', () => {
    fc.assert(
      fc.property(
        investmentContextArb,
        cashOutAmountArb,
        (ctx, cashOutAmount) => {
          const result = solveCashOut(ctx, { cashOutAmount });
          if (result.kind !== 'rate_check' || result.rowAnalysis === null) {
            return true;
          }
          const { before, after } = result.rowAnalysis;

          expect(before.debtServiceCoverage === null).toBe(
            before.annualDebtService === 0,
          );
          expect(before.returnOnWealth === null).toBe(before.equity <= 0);
          if (
            before.debtServiceCoverage !== null &&
            Number.isFinite(before.debtServiceCoverage)
          ) {
            expect(
              Math.abs(
                before.debtServiceCoverage * before.annualDebtService -
                  before.netOperatingIncome,
              ),
            ).toBeLessThan(1e-6);
          }
          if (
            before.returnOnWealth !== null &&
            Number.isFinite(before.returnOnWealth)
          ) {
            expect(
              Math.abs(
                before.returnOnWealth * before.equity - before.cashFlowAnnual,
              ),
            ).toBeLessThan(1e-6);
          }

          if (after !== null) {
            expect(after.debtServiceCoverage === null).toBe(
              after.annualDebtService === 0,
            );
            expect(after.returnOnWealth === null).toBe(after.equity <= 0);
            if (
              after.debtServiceCoverage !== null &&
              Number.isFinite(after.debtServiceCoverage)
            ) {
              expect(
                Math.abs(
                  after.debtServiceCoverage * after.annualDebtService -
                    before.netOperatingIncome,
                ),
              ).toBeLessThan(1e-6);
            }
            if (
              after.returnOnWealth !== null &&
              Number.isFinite(after.returnOnWealth)
            ) {
              expect(
                Math.abs(
                  after.returnOnWealth * after.equity - after.cashFlowAnnual,
                ),
              ).toBeLessThan(1e-6);
            }
          }
          return true;
        },
      ),
    );
  });
});

// ---------- Cross-module equivalence with computeIncomeMetrics ----------

describe('solveCashOut ROW cross-module equivalence', () => {
  it('before/after snapshots agree with computeIncomeMetrics', () => {
    fc.assert(
      fc.property(
        roundTripPropertyValueArb,
        roundTripFractionArb,
        roundTripRateArb,
        newTermArb,
        investmentInputsArb,
        (propertyValue, fraction, rTarget, n, inv) => {
          const newBalance = propertyValue * fraction;
          const currentMonthlyPayment = monthlyPayment(newBalance, rTarget, n);
          const balance = newBalance * 0.6;
          const cashOutAmount = newBalance - balance;
          const result = solveCashOut(
            {
              balance,
              propertyValue,
              currentMonthlyPayment,
              newTermMonths: n,
              maxLtv: MAX_LTV_PRIMARY,
              investmentInputs: inv,
            },
            { cashOutAmount },
          );
          if (result.kind !== 'rate_check') return false;
          const row = result.rowAnalysis;
          if (row === null || row.after === null) return false;

          const expenseRateField =
            inv.operatingExpenseRate !== undefined
              ? { operatingExpenseRate: inv.operatingExpenseRate }
              : {};

          const before = computeIncomeMetrics({
            propertyValue,
            mortgageBalance: balance,
            monthlyPayment: currentMonthlyPayment,
            monthlyGrossRent: inv.monthlyGrossRent,
            ...expenseRateField,
          });
          expect(row.before.annualGrossRent).toBe(before.annualGrossRent);
          expect(row.before.operatingExpenses).toBe(before.operatingExpenses);
          expect(row.before.netOperatingIncome).toBe(
            before.netOperatingIncome,
          );
          expect(row.before.annualDebtService).toBe(before.annualDebtService);
          expect(row.before.cashFlowAnnual).toBe(before.cashFlowAnnual);
          expect(row.before.equity).toBe(before.equity);
          expect(row.before.debtServiceCoverage).toBe(
            before.debtServiceCoverage,
          );
          expect(row.before.returnOnWealth).toBe(before.returnOnWealth);

          const after = computeIncomeMetrics({
            propertyValue,
            mortgageBalance: result.newBalance,
            monthlyPayment: row.after.monthlyPayment,
            monthlyGrossRent: inv.monthlyGrossRent,
            ...expenseRateField,
          });
          expect(row.after.annualDebtService).toBe(after.annualDebtService);
          expect(row.after.cashFlowAnnual).toBe(after.cashFlowAnnual);
          expect(row.after.equity).toBe(after.equity);
          expect(row.after.debtServiceCoverage).toBe(
            after.debtServiceCoverage,
          );
          expect(row.after.returnOnWealth).toBe(after.returnOnWealth);
          return true;
        },
      ),
    );
  });
});

// ---------- Exported constants ----------

describe('cash-out constants', () => {
  it('match their MATH.md §5.5 canonical values', () => {
    expect(MAX_LTV_PRIMARY).toBe(0.8);
    expect(MAX_LTV_INVESTMENT).toBe(0.75);
  });
});
