// Property-based tests for src/investment-metrics.ts — the investment
// property metrics (MATH.md §6). computeIncomeMetrics derives income,
// cash flow, and yield ratios; computeDepreciation derives IRS
// straight-line depreciation. Both are pure functions of their inputs.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { monthsBetween } from '../src/amortization.js';
import {
  DEFAULT_OPERATING_EXPENSE_RATE,
  STRUCTURE_VALUE_RATIO,
  DEPRECIATION_LIFE_YEARS,
  DSCR_CASH_FLOW_WARNING_THRESHOLD,
  DSCR_LOAN_ELIGIBILITY_THRESHOLD,
  computeIncomeMetrics,
  computeDepreciation,
} from '../src/investment-metrics.js';
import type {
  IncomeMetricsContext,
  DepreciationContext,
} from '../src/investment-metrics.js';

// ---------- Date helpers (mirrors amortization.test.ts) ----------

const pad = (n: number): string => String(n).padStart(2, '0');
const fmt = (y: number, m: number, d: number): string =>
  `${y}-${pad(m)}-${pad(d)}`;

/** A YYYY-MM-DD date with a day in 1–28 so month arithmetic stays clean. */
const dateFieldsArb = fc.record({
  y: fc.integer({ min: 1970, max: 2200 }),
  m: fc.integer({ min: 1, max: 12 }),
  d: fc.integer({ min: 1, max: 28 }),
});

const dateStringArb = dateFieldsArb.map(({ y, m, d }) => fmt(y, m, d));

/** Add k months to (y, m), returning the normalized [year, month]. */
const addMonths = (y: number, m: number, k: number): [number, number] => {
  const total = y * 12 + (m - 1) + k;
  return [Math.floor(total / 12), (total % 12) + 1];
};

// ---------- Generators ----------

const propertyValueArb = fc.double({
  min: 10_000,
  max: 1e7,
  noNaN: true,
  noDefaultInfinity: true,
});

const mortgageBalanceArb = fc.double({
  min: 0,
  max: 2e7,
  noNaN: true,
  noDefaultInfinity: true,
});

const monthlyPaymentArb = fc.double({
  min: 0,
  max: 1e5,
  noNaN: true,
  noDefaultInfinity: true,
});

const monthlyGrossRentArb = fc.double({
  min: 100,
  max: 1e5,
  noNaN: true,
  noDefaultInfinity: true,
});

const operatingExpenseRateArb = fc.double({
  min: 0,
  max: 1,
  noNaN: true,
  noDefaultInfinity: true,
});

const purchasePriceArb = fc.double({
  min: 10_000,
  max: 1e7,
  noNaN: true,
  noDefaultInfinity: true,
});

const structureRatioArb = fc.double({
  min: 0.01,
  max: 0.99,
  noNaN: true,
  noDefaultInfinity: true,
});

const lifeYearsArb = fc.double({
  min: 1,
  max: 100,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Income context with operatingExpenseRate sometimes absent. */
const incomeContextArb: fc.Arbitrary<IncomeMetricsContext> = fc.record(
  {
    propertyValue: propertyValueArb,
    mortgageBalance: mortgageBalanceArb,
    monthlyPayment: monthlyPaymentArb,
    monthlyGrossRent: monthlyGrossRentArb,
    operatingExpenseRate: operatingExpenseRateArb,
  },
  {
    requiredKeys: [
      'propertyValue',
      'mortgageBalance',
      'monthlyPayment',
      'monthlyGrossRent',
    ],
  },
);

/** Income context with the optional operatingExpenseRate key always absent. */
const baseIncomeContextArb = fc.record({
  propertyValue: propertyValueArb,
  mortgageBalance: mortgageBalanceArb,
  monthlyPayment: monthlyPaymentArb,
  monthlyGrossRent: monthlyGrossRentArb,
});

/** Depreciation context with structureRatio and lifeYears sometimes absent. */
const depreciationContextArb: fc.Arbitrary<DepreciationContext> = fc.record(
  {
    purchasePrice: purchasePriceArb,
    purchaseDate: dateStringArb,
    asOfDate: dateStringArb,
    structureRatio: structureRatioArb,
    lifeYears: lifeYearsArb,
  },
  { requiredKeys: ['purchasePrice', 'purchaseDate', 'asOfDate'] },
);

/** Depreciation context with both optional keys always absent. */
const baseDepreciationContextArb = fc.record({
  purchasePrice: purchasePriceArb,
  purchaseDate: dateStringArb,
  asOfDate: dateStringArb,
});

// ---------- §6 Income, cash flow, and yield metrics ----------

describe('computeIncomeMetrics', () => {
  it('throws on a non-positive propertyValue', () => {
    for (const propertyValue of [0, -1, -100]) {
      expect(() =>
        computeIncomeMetrics({
          propertyValue,
          mortgageBalance: 100_000,
          monthlyPayment: 1000,
          monthlyGrossRent: 2000,
        }),
      ).toThrow();
    }
  });

  it('throws on a non-positive monthlyGrossRent', () => {
    for (const monthlyGrossRent of [0, -1, -100]) {
      expect(() =>
        computeIncomeMetrics({
          propertyValue: 500_000,
          mortgageBalance: 100_000,
          monthlyPayment: 1000,
          monthlyGrossRent,
        }),
      ).toThrow();
    }
  });

  it('accepts a zero mortgageBalance and zero monthlyPayment', () => {
    expect(() =>
      computeIncomeMetrics({
        propertyValue: 500_000,
        mortgageBalance: 0,
        monthlyPayment: 0,
        monthlyGrossRent: 2000,
      }),
    ).not.toThrow();
  });

  it('display values match the §6 definitional formulas', () => {
    fc.assert(
      fc.property(incomeContextArb, (ctx) => {
        const r = computeIncomeMetrics(ctx);
        const rate = ctx.operatingExpenseRate ?? DEFAULT_OPERATING_EXPENSE_RATE;
        expect(r.annualGrossRent).toBe(ctx.monthlyGrossRent * 12);
        expect(r.operatingExpenses).toBe(r.annualGrossRent * rate);
        expect(r.netOperatingIncome).toBe(
          r.annualGrossRent - r.operatingExpenses,
        );
        expect(r.annualDebtService).toBe(ctx.monthlyPayment * 12);
        expect(r.cashFlowAnnual).toBe(
          r.netOperatingIncome - r.annualDebtService,
        );
        expect(r.cashFlowMonthly).toBe(r.cashFlowAnnual / 12);
        expect(r.capRate).toBe(r.netOperatingIncome / ctx.propertyValue);
        expect(r.grossRentMultiplier).toBe(
          ctx.propertyValue / r.annualGrossRent,
        );
        expect(r.equity).toBe(ctx.propertyValue - ctx.mortgageBalance);
        return true;
      }),
    );
  });

  it('ratios round-trip to their numerators (identity laws)', () => {
    fc.assert(
      fc.property(incomeContextArb, (ctx) => {
        const r = computeIncomeMetrics(ctx);
        expect(
          Math.abs(r.capRate * ctx.propertyValue - r.netOperatingIncome),
        ).toBeLessThan(1e-6);
        expect(
          Math.abs(
            r.grossRentMultiplier * r.annualGrossRent - ctx.propertyValue,
          ),
        ).toBeLessThan(1e-6);
        // The ratio round-trips only when it is a finite number: a
        // denormally tiny debt service or equity overflows the ratio to
        // Infinity, where the identity is numerically vacuous.
        if (r.debtServiceCoverage !== null && Number.isFinite(r.debtServiceCoverage)) {
          expect(
            Math.abs(
              r.debtServiceCoverage * r.annualDebtService -
                r.netOperatingIncome,
            ),
          ).toBeLessThan(1e-6);
        }
        if (r.returnOnWealth !== null && Number.isFinite(r.returnOnWealth)) {
          expect(
            Math.abs(r.returnOnWealth * r.equity - r.cashFlowAnnual),
          ).toBeLessThan(1e-6);
        }
        return true;
      }),
    );
  });

  it('flows decompose additively', () => {
    fc.assert(
      fc.property(incomeContextArb, (ctx) => {
        const r = computeIncomeMetrics(ctx);
        // Income split: gross rent = operating expenses + NOI.
        expect(
          Math.abs(
            r.annualGrossRent - (r.operatingExpenses + r.netOperatingIncome),
          ),
        ).toBeLessThan(1e-6);
        // NOI flow split: NOI = annual debt service + cash flow.
        expect(
          Math.abs(
            r.netOperatingIncome - (r.annualDebtService + r.cashFlowAnnual),
          ),
        ).toBeLessThan(1e-6);
        // Equity split. Tolerance, not exact equality: (p - m) + m does not
        // round-trip in IEEE 754 when propertyValue << mortgageBalance and
        // low-order bits of propertyValue fall below ulp(mortgageBalance).
        expect(
          Math.abs(r.equity + ctx.mortgageBalance - ctx.propertyValue),
        ).toBeLessThan(1e-6);
        return true;
      }),
    );
  });

  it('null mapping: DSCR iff there is debt, ROW iff there is positive equity', () => {
    fc.assert(
      fc.property(incomeContextArb, (ctx) => {
        const r = computeIncomeMetrics(ctx);
        expect(r.debtServiceCoverage === null).toBe(ctx.monthlyPayment === 0);
        expect(r.returnOnWealth === null).toBe(
          ctx.mortgageBalance >= ctx.propertyValue,
        );
        expect(r.returnOnWealth === null).toBe(r.equity <= 0);
        return true;
      }),
    );
  });

  it('omitting operatingExpenseRate matches an explicit default', () => {
    fc.assert(
      fc.property(baseIncomeContextArb, (base) => {
        expect(computeIncomeMetrics(base)).toEqual(
          computeIncomeMetrics({
            ...base,
            operatingExpenseRate: DEFAULT_OPERATING_EXPENSE_RATE,
          }),
        );
        return true;
      }),
    );
  });

  it('canonical example: $500k property, $400k mortgage, negative cash flow', () => {
    const r = computeIncomeMetrics({
      propertyValue: 500_000,
      mortgageBalance: 400_000,
      monthlyPayment: 2400,
      monthlyGrossRent: 3500,
    });
    expect(r.equity).toBe(100_000);
    expect(r.annualGrossRent).toBe(42_000);
    expect(r.operatingExpenses).toBe(16_800);
    expect(r.netOperatingIncome).toBe(25_200);
    expect(r.annualDebtService).toBe(28_800);
    expect(r.cashFlowAnnual).toBe(-3_600);
    expect(r.debtServiceCoverage).toBe(25_200 / 28_800);
    expect(r.debtServiceCoverage).toBeLessThan(DSCR_CASH_FLOW_WARNING_THRESHOLD);
    expect(r.debtServiceCoverage).toBeLessThan(
      DSCR_LOAN_ELIGIBILITY_THRESHOLD,
    );
  });
});

// ---------- §6 Depreciation ----------

describe('computeDepreciation', () => {
  it('throws on a non-positive purchasePrice', () => {
    for (const purchasePrice of [0, -1, -100]) {
      expect(() =>
        computeDepreciation({
          purchasePrice,
          purchaseDate: '2020-01-01',
          asOfDate: '2025-01-01',
        }),
      ).toThrow();
    }
  });

  it('throws on a non-positive lifeYears', () => {
    for (const lifeYears of [0, -1, -27]) {
      expect(() =>
        computeDepreciation({
          purchasePrice: 400_000,
          purchaseDate: '2020-01-01',
          asOfDate: '2025-01-01',
          lifeYears,
        }),
      ).toThrow();
    }
  });

  it('display values match the §6 definitional formulas', () => {
    fc.assert(
      fc.property(depreciationContextArb, (ctx) => {
        const r = computeDepreciation(ctx);
        const structureRatio = ctx.structureRatio ?? STRUCTURE_VALUE_RATIO;
        const lifeYears = ctx.lifeYears ?? DEPRECIATION_LIFE_YEARS;
        expect(r.structureValue).toBe(ctx.purchasePrice * structureRatio);
        expect(r.annualDepreciation).toBe(r.structureValue / lifeYears);
        expect(r.monthsHeld).toBe(
          monthsBetween(ctx.purchaseDate, ctx.asOfDate),
        );
        expect(r.yearsHeld).toBe(r.monthsHeld / 12);
        expect(r.accumulatedDepreciation).toBe(
          Math.min(r.annualDepreciation * r.yearsHeld, r.structureValue),
        );
        expect(r.adjustedCostBasis).toBe(
          ctx.purchasePrice - r.accumulatedDepreciation,
        );
        return true;
      }),
    );
  });

  it('structure value and land value decompose to the purchase price', () => {
    fc.assert(
      fc.property(depreciationContextArb, (ctx) => {
        const r = computeDepreciation(ctx);
        const structureRatio = ctx.structureRatio ?? STRUCTURE_VALUE_RATIO;
        const land = ctx.purchasePrice * (1 - structureRatio);
        return Math.abs(r.structureValue + land - ctx.purchasePrice) < 1e-6;
      }),
    );
  });

  it('annual depreciation × life recovers the structure value', () => {
    fc.assert(
      fc.property(depreciationContextArb, (ctx) => {
        const r = computeDepreciation(ctx);
        const lifeYears = ctx.lifeYears ?? DEPRECIATION_LIFE_YEARS;
        return (
          Math.abs(r.annualDepreciation * lifeYears - r.structureValue) < 1e-6
        );
      }),
    );
  });

  it('cap law: accumulated depreciation is capped at structure value past life', () => {
    fc.assert(
      fc.property(
        purchasePriceArb,
        structureRatioArb,
        lifeYearsArb,
        dateFieldsArb,
        fc.integer({ min: 1300, max: 3000 }),
        (purchasePrice, structureRatio, lifeYears, start, k) => {
          const [ey, em] = addMonths(start.y, start.m, k);
          const r = computeDepreciation({
            purchasePrice,
            structureRatio,
            lifeYears,
            purchaseDate: fmt(start.y, start.m, start.d),
            asOfDate: fmt(ey, em, start.d),
          });
          // k >= 1300 months => >108 years held, above any lifeYears <= 100.
          expect(r.yearsHeld).toBeGreaterThan(lifeYears);
          return r.accumulatedDepreciation === r.structureValue;
        },
      ),
    );
  });

  it('cap law: accumulated depreciation is uncapped within the depreciation life', () => {
    fc.assert(
      fc.property(
        purchasePriceArb,
        structureRatioArb,
        lifeYearsArb,
        dateFieldsArb,
        fc.integer({ min: 0, max: 12 }),
        (purchasePrice, structureRatio, lifeYears, start, k) => {
          const [ey, em] = addMonths(start.y, start.m, k);
          const r = computeDepreciation({
            purchasePrice,
            structureRatio,
            lifeYears,
            purchaseDate: fmt(start.y, start.m, start.d),
            asOfDate: fmt(ey, em, start.d),
          });
          // k <= 12 months => <=1 year held, at or below any lifeYears >= 1.
          expect(r.yearsHeld).toBeLessThanOrEqual(lifeYears);
          return (
            r.accumulatedDepreciation ===
            r.annualDepreciation * r.yearsHeld
          );
        },
      ),
    );
  });

  it('zero held: no depreciation when asOfDate equals purchaseDate', () => {
    fc.assert(
      fc.property(purchasePriceArb, dateStringArb, (purchasePrice, date) => {
        const r = computeDepreciation({
          purchasePrice,
          purchaseDate: date,
          asOfDate: date,
        });
        return (
          r.monthsHeld === 0 &&
          r.accumulatedDepreciation === 0 &&
          r.adjustedCostBasis === purchasePrice
        );
      }),
    );
  });

  it('future purchase: a negative window yields zero accumulated depreciation', () => {
    fc.assert(
      fc.property(
        purchasePriceArb,
        dateFieldsArb,
        fc.integer({ min: 1, max: 600 }),
        (purchasePrice, start, k) => {
          // purchaseDate is later than asOfDate; monthsBetween returns 0.
          const [py, pm] = addMonths(start.y, start.m, k);
          const r = computeDepreciation({
            purchasePrice,
            purchaseDate: fmt(py, pm, start.d),
            asOfDate: fmt(start.y, start.m, start.d),
          });
          return (
            r.monthsHeld === 0 &&
            r.accumulatedDepreciation === 0 &&
            r.adjustedCostBasis === purchasePrice
          );
        },
      ),
    );
  });

  it('respects the depreciation and basis bounds', () => {
    fc.assert(
      fc.property(depreciationContextArb, (ctx) => {
        const r = computeDepreciation(ctx);
        return (
          r.accumulatedDepreciation >= 0 &&
          r.accumulatedDepreciation <= r.structureValue &&
          r.adjustedCostBasis <= ctx.purchasePrice &&
          r.adjustedCostBasis >= ctx.purchasePrice - r.structureValue
        );
      }),
    );
  });

  it('omitting structureRatio matches an explicit default', () => {
    fc.assert(
      fc.property(baseDepreciationContextArb, (base) => {
        expect(computeDepreciation(base)).toEqual(
          computeDepreciation({
            ...base,
            structureRatio: STRUCTURE_VALUE_RATIO,
          }),
        );
        return true;
      }),
    );
  });

  it('omitting lifeYears matches an explicit default', () => {
    fc.assert(
      fc.property(baseDepreciationContextArb, (base) => {
        expect(computeDepreciation(base)).toEqual(
          computeDepreciation({
            ...base,
            lifeYears: DEPRECIATION_LIFE_YEARS,
          }),
        );
        return true;
      }),
    );
  });

  it('canonical example: $400k residential rental, 5 years held', () => {
    const r = computeDepreciation({
      purchasePrice: 400_000,
      purchaseDate: '2020-01-01',
      asOfDate: '2025-01-01',
    });
    expect(r.structureValue).toBe(320_000);
    expect(r.annualDepreciation).toBe(320_000 / 27.5);
    expect(r.monthsHeld).toBe(60);
    expect(r.yearsHeld).toBe(5);
    expect(r.accumulatedDepreciation).toBeCloseTo(58_181.82, 2);
    expect(r.adjustedCostBasis).toBeCloseTo(341_818.18, 2);
  });

  it('canonical example: held beyond life caps at the structure value', () => {
    const r = computeDepreciation({
      purchasePrice: 400_000,
      purchaseDate: '2020-01-01',
      asOfDate: '2055-01-01',
    });
    expect(r.accumulatedDepreciation).toBe(320_000);
    expect(r.adjustedCostBasis).toBe(80_000);
  });

  it('canonical example: commercial override (39-year life, 1 year held)', () => {
    const r = computeDepreciation({
      purchasePrice: 1_000_000,
      purchaseDate: '2020-06-15',
      asOfDate: '2021-06-15',
      structureRatio: 0.8,
      lifeYears: 39,
    });
    expect(r.structureValue).toBe(800_000);
    expect(r.annualDepreciation).toBe(800_000 / 39);
    expect(r.monthsHeld).toBe(12);
    expect(r.accumulatedDepreciation).toBeCloseTo(800_000 / 39, 6);
  });
});

// ---------- Exported constants ----------

describe('investment-metrics constants', () => {
  it('match their MATH.md §6 canonical values', () => {
    expect(DEFAULT_OPERATING_EXPENSE_RATE).toBe(0.4);
    expect(STRUCTURE_VALUE_RATIO).toBe(0.8);
    expect(DEPRECIATION_LIFE_YEARS).toBe(27.5);
    expect(DSCR_CASH_FLOW_WARNING_THRESHOLD).toBe(1.0);
    expect(DSCR_LOAN_ELIGIBILITY_THRESHOLD).toBe(1.25);
  });
});
