// Property-based tests for src/tax-optimization.ts — the §5.6 tax
// optimization module. Both functions are informational: they replay
// §2.5 annual interest and §5.6 deduction formulas over current loan
// facts. No rate solve, no backwards calculation.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { annualInterest } from '../src/amortization.js';
import { computeDepreciation } from '../src/investment-metrics.js';
import {
  STRUCTURE_VALUE_RATIO,
  DEPRECIATION_LIFE_YEARS,
} from '../src/investment-metrics.js';
import {
  TAX_DISCLAIMER,
  DEDUCTIBLE_BALANCE_CAP,
  DEPRECIATION_RECAPTURE_NOTE,
  STANDARD_DEDUCTION_2024,
  computePrimaryResidenceTax,
  computeInvestmentTax,
} from '../src/tax-optimization.js';
import type {
  PrimaryResidenceTaxContext,
  InvestmentTaxContext,
  InvestmentTaxPurchaseInfo,
} from '../src/tax-optimization.js';

// ---------- Date helpers (mirrors investment-metrics.test.ts) ----------

const pad = (n: number): string => String(n).padStart(2, '0');
const fmt = (y: number, m: number, d: number): string =>
  `${y}-${pad(m)}-${pad(d)}`;

const dateStringArb = fc
  .record({
    y: fc.integer({ min: 1990, max: 2100 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ y, m, d }) => fmt(y, m, d));

// ---------- Generators ----------

const mortgageBalanceArb = fc.double({
  min: 0,
  max: 5e6,
  noNaN: true,
  noDefaultInfinity: true,
});

const monthlyRateArb = fc.double({
  min: 0,
  max: 0.2 / 12,
  noNaN: true,
  noDefaultInfinity: true,
});

const monthlyPaymentArb = fc.double({
  min: 0,
  max: 1e5,
  noNaN: true,
  noDefaultInfinity: true,
});

const propertyValueArb = fc.double({
  min: 10_000,
  max: 1e7,
  noNaN: true,
  noDefaultInfinity: true,
});

const purchasePriceArb = fc.double({
  min: 10_000,
  max: 1e7,
  noNaN: true,
  noDefaultInfinity: true,
});

const marginalTaxRateArb = fc.double({
  min: 0,
  max: 1,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Primary-residence context; marginalTaxRate sometimes absent. */
const primaryContextArb: fc.Arbitrary<PrimaryResidenceTaxContext> = fc.record(
  {
    mortgageBalance: mortgageBalanceArb,
    monthlyRate: monthlyRateArb,
    monthlyPayment: monthlyPaymentArb,
    marginalTaxRate: marginalTaxRateArb,
  },
  { requiredKeys: ['mortgageBalance', 'monthlyRate', 'monthlyPayment'] },
);

const purchaseInfoArb: fc.Arbitrary<InvestmentTaxPurchaseInfo> = fc.record({
  purchasePrice: purchasePriceArb,
  purchaseDate: dateStringArb,
  asOfDate: dateStringArb,
});

/** Investment context; purchaseInfo and marginalTaxRate sometimes absent. */
const investmentContextArb: fc.Arbitrary<InvestmentTaxContext> = fc.record(
  {
    mortgageBalance: mortgageBalanceArb,
    monthlyRate: monthlyRateArb,
    monthlyPayment: monthlyPaymentArb,
    propertyValue: propertyValueArb,
    purchaseInfo: purchaseInfoArb,
    marginalTaxRate: marginalTaxRateArb,
  },
  {
    requiredKeys: [
      'mortgageBalance',
      'monthlyRate',
      'monthlyPayment',
      'propertyValue',
    ],
  },
);

// ---------- Constants ----------

describe('tax-optimization constants', () => {
  it('match their MATH.md §5.6 canonical values', () => {
    expect(DEDUCTIBLE_BALANCE_CAP).toBe(750_000);
    expect(STANDARD_DEDUCTION_2024).toEqual({ single: 14_600, married: 29_200 });
    expect(TAX_DISCLAIMER).toContain('informational purposes only');
    expect(TAX_DISCLAIMER).toContain('does not constitute tax advice');
    expect(DEPRECIATION_RECAPTURE_NOTE).toContain('25% recapture tax');
  });
});

// ---------- §5.6 Primary residence ----------

describe('computePrimaryResidenceTax', () => {
  it('throws on a negative mortgageBalance', () => {
    for (const mortgageBalance of [-1, -100]) {
      expect(() =>
        computePrimaryResidenceTax({
          mortgageBalance,
          monthlyRate: 0.005,
          monthlyPayment: 2000,
        }),
      ).toThrow();
    }
  });

  it('throws on a marginalTaxRate outside [0, 1]', () => {
    for (const marginalTaxRate of [-0.1, 1.5, -1]) {
      expect(() =>
        computePrimaryResidenceTax({
          mortgageBalance: 400_000,
          monthlyRate: 0.005,
          monthlyPayment: 2000,
          marginalTaxRate,
        }),
      ).toThrow();
    }
  });

  it('accepts the marginalTaxRate boundary values 0 and 1', () => {
    for (const marginalTaxRate of [0, 1]) {
      expect(() =>
        computePrimaryResidenceTax({
          mortgageBalance: 400_000,
          monthlyRate: 0.005,
          monthlyPayment: 2000,
          marginalTaxRate,
        }),
      ).not.toThrow();
    }
  });

  it('display values match the §5.6 formulas', () => {
    fc.assert(
      fc.property(primaryContextArb, (ctx) => {
        const r = computePrimaryResidenceTax(ctx);
        expect(r.disclaimer).toBe(TAX_DISCLAIMER);
        expect(r.deductibleBalanceCap).toBe(DEDUCTIBLE_BALANCE_CAP);
        expect(r.annualInterest).toBe(
          annualInterest(ctx.mortgageBalance, ctx.monthlyRate, ctx.monthlyPayment),
        );
        expect(r.fullyDeductible).toBe(
          ctx.mortgageBalance <= DEDUCTIBLE_BALANCE_CAP,
        );
        if (r.fullyDeductible) {
          expect(r.deductibleInterest).toBe(r.annualInterest);
        } else {
          expect(r.deductibleInterest).toBe(
            r.annualInterest * (DEDUCTIBLE_BALANCE_CAP / ctx.mortgageBalance),
          );
        }
        if (ctx.marginalTaxRate === undefined) {
          expect(r.estimatedTaxBenefit).toBeNull();
        } else {
          expect(r.estimatedTaxBenefit).toBe(
            r.deductibleInterest * ctx.marginalTaxRate,
          );
        }
        return true;
      }),
    );
  });

  it('the cap never increases the deduction beyond annual interest', () => {
    fc.assert(
      fc.property(primaryContextArb, (ctx) => {
        const r = computePrimaryResidenceTax(ctx);
        return (
          r.annualInterest >= 0 &&
          r.deductibleInterest >= 0 &&
          r.deductibleInterest <= r.annualInterest
        );
      }),
    );
  });

  it('canonical: balance at the cap exactly is fully deductible', () => {
    const r = computePrimaryResidenceTax({
      mortgageBalance: DEDUCTIBLE_BALANCE_CAP,
      monthlyRate: 0.06 / 12,
      monthlyPayment: 4500,
    });
    expect(r.fullyDeductible).toBe(true);
    expect(r.deductibleInterest).toBe(r.annualInterest);
    expect(r.estimatedTaxBenefit).toBeNull();
  });

  it('canonical: a $1M balance is deductible only on the $750k share', () => {
    const r = computePrimaryResidenceTax({
      mortgageBalance: 1_000_000,
      monthlyRate: 0.06 / 12,
      monthlyPayment: 6000,
      marginalTaxRate: 0.24,
    });
    expect(r.fullyDeductible).toBe(false);
    // 750_000 / 1_000_000 = 0.75.
    expect(r.deductibleInterest).toBe(r.annualInterest * 0.75);
    expect(r.estimatedTaxBenefit).toBe(r.deductibleInterest * 0.24);
  });
});

// ---------- §5.6 Investment / multi_family ----------

describe('computeInvestmentTax', () => {
  it('throws on a negative mortgageBalance', () => {
    for (const mortgageBalance of [-1, -100]) {
      expect(() =>
        computeInvestmentTax({
          mortgageBalance,
          monthlyRate: 0.005,
          monthlyPayment: 2000,
          propertyValue: 500_000,
        }),
      ).toThrow();
    }
  });

  it('throws on a non-positive propertyValue', () => {
    for (const propertyValue of [0, -1, -100]) {
      expect(() =>
        computeInvestmentTax({
          mortgageBalance: 400_000,
          monthlyRate: 0.005,
          monthlyPayment: 2000,
          propertyValue,
        }),
      ).toThrow();
    }
  });

  it('throws on a marginalTaxRate outside [0, 1]', () => {
    for (const marginalTaxRate of [-0.1, 1.5, -1]) {
      expect(() =>
        computeInvestmentTax({
          mortgageBalance: 400_000,
          monthlyRate: 0.005,
          monthlyPayment: 2000,
          propertyValue: 500_000,
          marginalTaxRate,
        }),
      ).toThrow();
    }
  });

  it('display values match the §5.6 formulas', () => {
    fc.assert(
      fc.property(investmentContextArb, (ctx) => {
        const r = computeInvestmentTax(ctx);
        expect(r.disclaimer).toBe(TAX_DISCLAIMER);
        expect(r.recaptureNote).toBe(DEPRECIATION_RECAPTURE_NOTE);
        expect(r.annualInterest).toBe(
          annualInterest(ctx.mortgageBalance, ctx.monthlyRate, ctx.monthlyPayment),
        );
        expect(r.combinedAnnualDeduction).toBe(
          r.annualInterest + r.annualDepreciation,
        );
        if (ctx.marginalTaxRate === undefined) {
          expect(r.estimatedTaxShield).toBeNull();
        } else {
          expect(r.estimatedTaxShield).toBe(
            r.combinedAnnualDeduction * ctx.marginalTaxRate,
          );
        }
        return true;
      }),
    );
  });

  it('estimated path: no purchaseInfo means depreciation from current value', () => {
    fc.assert(
      fc.property(investmentContextArb, (ctx) => {
        if (ctx.purchaseInfo !== undefined) return true;
        const r = computeInvestmentTax(ctx);
        expect(r.depreciationSource).toBe('estimated_from_value');
        expect(r.accumulatedDepreciation).toBeNull();
        expect(r.annualDepreciation).toBe(
          (ctx.propertyValue * STRUCTURE_VALUE_RATIO) / DEPRECIATION_LIFE_YEARS,
        );
        return true;
      }),
    );
  });

  it('purchase path: depreciation agrees exactly with computeDepreciation', () => {
    fc.assert(
      fc.property(investmentContextArb, (ctx) => {
        if (ctx.purchaseInfo === undefined) return true;
        const r = computeInvestmentTax(ctx);
        const dep = computeDepreciation({
          purchasePrice: ctx.purchaseInfo.purchasePrice,
          purchaseDate: ctx.purchaseInfo.purchaseDate,
          asOfDate: ctx.purchaseInfo.asOfDate,
        });
        expect(r.depreciationSource).toBe('purchase_records');
        expect(r.annualDepreciation).toBe(dep.annualDepreciation);
        expect(r.accumulatedDepreciation).toBe(dep.accumulatedDepreciation);
        expect(r.accumulatedDepreciation).not.toBeNull();
        return true;
      }),
    );
  });

  it('combined deduction is never below annual interest alone', () => {
    fc.assert(
      fc.property(investmentContextArb, (ctx) => {
        const r = computeInvestmentTax(ctx);
        return (
          r.annualDepreciation >= 0 &&
          r.combinedAnnualDeduction >= r.annualInterest
        );
      }),
    );
  });

  it('canonical: estimated depreciation from a $500k property value', () => {
    const r = computeInvestmentTax({
      mortgageBalance: 300_000,
      monthlyRate: 0.06 / 12,
      monthlyPayment: 1800,
      propertyValue: 500_000,
    });
    expect(r.depreciationSource).toBe('estimated_from_value');
    expect(r.accumulatedDepreciation).toBeNull();
    // 500_000 * 0.80 / 27.5.
    expect(r.annualDepreciation).toBe((500_000 * 0.8) / 27.5);
    expect(r.estimatedTaxShield).toBeNull();
  });

  it('canonical: exact depreciation from $400k purchase records, 5 years held', () => {
    const r = computeInvestmentTax({
      mortgageBalance: 300_000,
      monthlyRate: 0.06 / 12,
      monthlyPayment: 1800,
      propertyValue: 500_000,
      purchaseInfo: {
        purchasePrice: 400_000,
        purchaseDate: '2020-01-01',
        asOfDate: '2025-01-01',
      },
      marginalTaxRate: 0.32,
    });
    expect(r.depreciationSource).toBe('purchase_records');
    expect(r.annualDepreciation).toBe((400_000 * 0.8) / 27.5);
    expect(r.accumulatedDepreciation).toBeCloseTo(58_181.82, 2);
    expect(r.estimatedTaxShield).toBe(r.combinedAnnualDeduction * 0.32);
  });
});
