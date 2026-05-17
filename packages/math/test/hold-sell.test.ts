// Property-based tests for src/hold-sell.ts — the §7 hold/sell analysis.
// computeSellScenario is one-shot; computeHoldScenario projects year by
// year; compareHoldVsSell orchestrates both and locates the crossover.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { balanceAtMonth } from '../src/amortization.js';
import { DEFAULT_OPERATING_EXPENSE_RATE } from '../src/investment-metrics.js';
import {
  DEFAULT_APPRECIATION_RATE,
  DEFAULT_RENT_GROWTH_RATE,
  DEFAULT_AGENT_COMMISSION_RATE,
  DEFAULT_SALE_CLOSING_COSTS_RATE,
  DEFAULT_LONG_TERM_CAP_GAINS_RATE,
  DEFAULT_DEPRECIATION_RECAPTURE_RATE,
  DEFAULT_REINVESTMENT_RETURN_RATE,
  computeSellScenario,
  computeHoldScenario,
  compareHoldVsSell,
} from '../src/hold-sell.js';
import type {
  HoldSellAssumptions,
  SellScenarioContext,
  HoldScenarioContext,
  HoldVsSellContext,
} from '../src/hold-sell.js';

// ---------- Tolerance helpers ----------

/** Relative closeness: |a - b| <= tol * max(1, |b|). */
const closeRel = (a: number, b: number, tol: number): boolean =>
  Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// ---------- Generators ----------

const propertyValueArb = fc.double({
  min: 50_000,
  max: 1e7,
  noNaN: true,
  noDefaultInfinity: true,
});

const mortgageBalanceArb = fc.double({
  min: 0,
  max: 1e7,
  noNaN: true,
  noDefaultInfinity: true,
});

const basisArb = fc.double({
  min: 0,
  max: 1e7,
  noNaN: true,
  noDefaultInfinity: true,
});

const accumulatedDepreciationArb = fc.double({
  min: 0,
  max: 5e5,
  noNaN: true,
  noDefaultInfinity: true,
});

const projectionYearsArb = fc.integer({ min: 1, max: 30 });

const moneyFlowArb = fc.double({
  min: 100,
  max: 1e5,
  noNaN: true,
  noDefaultInfinity: true,
});

const monthlyRateArb = fc.double({
  min: 0.001 / 12,
  max: 0.15 / 12,
  noNaN: true,
  noDefaultInfinity: true,
});

const annualDepreciationArb = fc.double({
  min: 0,
  max: 5e5,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Sell-side assumptions: every rate field optional. */
const sellAssumptionsArb: fc.Arbitrary<HoldSellAssumptions> = fc.record(
  {
    agentCommissionRate: fc.double({
      min: 0,
      max: 0.2,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    saleClosingCostsRate: fc.double({
      min: 0,
      max: 0.2,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    longTermCapGainsRate: fc.double({
      min: 0,
      max: 0.4,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    depreciationRecaptureRate: fc.double({
      min: 0,
      max: 0.4,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    reinvestmentReturnRate: fc.double({
      min: 0,
      max: 0.3,
      noNaN: true,
      noDefaultInfinity: true,
    }),
  },
  { requiredKeys: [] },
);

/** Hold-side assumptions: appreciation / rent growth / marginal tax. */
const holdAssumptionsArb: fc.Arbitrary<HoldSellAssumptions> = fc.record(
  {
    annualAppreciationRate: fc.double({
      min: -0.05,
      max: 0.15,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    annualRentGrowthRate: fc.double({
      min: -0.05,
      max: 0.15,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    marginalTaxRate: fc.double({
      min: 0,
      max: 0.5,
      noNaN: true,
      noDefaultInfinity: true,
    }),
  },
  { requiredKeys: [] },
);

/** Sell context without an assumptions key, for the equivalence test. */
const baseSellContextArb = fc.record({
  propertyValue: propertyValueArb,
  mortgageBalance: mortgageBalanceArb,
  adjustedCostBasis: basisArb,
  accumulatedDepreciation: accumulatedDepreciationArb,
  projectionYears: projectionYearsArb,
});

/** Sell context; assumptions sometimes absent. */
const sellContextArb: fc.Arbitrary<SellScenarioContext> = fc.record(
  {
    propertyValue: propertyValueArb,
    mortgageBalance: mortgageBalanceArb,
    adjustedCostBasis: basisArb,
    accumulatedDepreciation: accumulatedDepreciationArb,
    projectionYears: projectionYearsArb,
    assumptions: sellAssumptionsArb,
  },
  {
    requiredKeys: [
      'propertyValue',
      'mortgageBalance',
      'adjustedCostBasis',
      'accumulatedDepreciation',
      'projectionYears',
    ],
  },
);

/** Hold context without assumptions or operatingExpenseRate keys. */
const baseHoldContextArb = fc.record({
  propertyValue: propertyValueArb,
  monthlyGrossRent: moneyFlowArb,
  mortgageBalance: mortgageBalanceArb,
  monthlyPayment: moneyFlowArb,
  monthlyRate: monthlyRateArb,
  annualDepreciation: annualDepreciationArb,
  projectionYears: projectionYearsArb,
});

/** Hold context; operatingExpenseRate and assumptions sometimes absent. */
const holdContextArb: fc.Arbitrary<HoldScenarioContext> = fc.record(
  {
    propertyValue: propertyValueArb,
    monthlyGrossRent: moneyFlowArb,
    operatingExpenseRate: fc.double({
      min: 0,
      max: 1,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    mortgageBalance: mortgageBalanceArb,
    monthlyPayment: moneyFlowArb,
    monthlyRate: monthlyRateArb,
    annualDepreciation: annualDepreciationArb,
    projectionYears: projectionYearsArb,
    assumptions: holdAssumptionsArb,
  },
  {
    requiredKeys: [
      'propertyValue',
      'monthlyGrossRent',
      'mortgageBalance',
      'monthlyPayment',
      'monthlyRate',
      'annualDepreciation',
      'projectionYears',
    ],
  },
);

/** Matched hold/sell contexts: both share the same projectionYears. */
const holdVsSellContextArb: fc.Arbitrary<HoldVsSellContext> = fc
  .record({
    sell: sellContextArb,
    hold: holdContextArb,
    years: projectionYearsArb,
  })
  .map(({ sell, hold, years }) => ({
    sell: { ...sell, projectionYears: years },
    hold: { ...hold, projectionYears: years },
  }));

// ---------- Constants ----------

describe('hold-sell constants', () => {
  it('match their MATH.md §7 canonical values', () => {
    expect(DEFAULT_APPRECIATION_RATE).toBe(0.03);
    expect(DEFAULT_RENT_GROWTH_RATE).toBe(0.02);
    expect(DEFAULT_AGENT_COMMISSION_RATE).toBe(0.06);
    expect(DEFAULT_SALE_CLOSING_COSTS_RATE).toBe(0.01);
    expect(DEFAULT_LONG_TERM_CAP_GAINS_RATE).toBe(0.15);
    expect(DEFAULT_DEPRECIATION_RECAPTURE_RATE).toBe(0.25);
    expect(DEFAULT_REINVESTMENT_RETURN_RATE).toBe(0.07);
  });
});

// ---------- §7.1 Sell scenario ----------

describe('computeSellScenario', () => {
  it('throws on a non-positive projectionYears', () => {
    for (const projectionYears of [0, -1, -10]) {
      expect(() =>
        computeSellScenario({
          propertyValue: 400_000,
          mortgageBalance: 200_000,
          adjustedCostBasis: 300_000,
          accumulatedDepreciation: 40_000,
          projectionYears,
        }),
      ).toThrow();
    }
  });

  it('display values match the §7.1 formulas', () => {
    fc.assert(
      fc.property(sellContextArb, (ctx) => {
        const r = computeSellScenario(ctx);
        const a = ctx.assumptions ?? {};
        const agentRate = a.agentCommissionRate ?? DEFAULT_AGENT_COMMISSION_RATE;
        const closingRate =
          a.saleClosingCostsRate ?? DEFAULT_SALE_CLOSING_COSTS_RATE;
        const capGainsRate =
          a.longTermCapGainsRate ?? DEFAULT_LONG_TERM_CAP_GAINS_RATE;
        const recaptureRate =
          a.depreciationRecaptureRate ?? DEFAULT_DEPRECIATION_RECAPTURE_RATE;
        const reinvRate =
          a.reinvestmentReturnRate ?? DEFAULT_REINVESTMENT_RETURN_RATE;

        expect(r.salePrice).toBe(ctx.propertyValue);
        expect(r.agentCommission).toBe(ctx.propertyValue * agentRate);
        expect(r.saleClosingCosts).toBe(ctx.propertyValue * closingRate);
        expect(r.netBeforeTax).toBe(
          ctx.propertyValue -
            r.agentCommission -
            r.saleClosingCosts -
            ctx.mortgageBalance,
        );
        expect(r.gain).toBe(ctx.propertyValue - ctx.adjustedCostBasis);
        expect(r.depreciationRecaptureTax).toBe(
          ctx.accumulatedDepreciation * recaptureRate,
        );
        expect(r.longTermGain).toBe(
          Math.max(0, r.gain - ctx.accumulatedDepreciation),
        );
        expect(r.capitalGainsTax).toBe(r.longTermGain * capGainsRate);
        expect(r.netProceeds).toBe(
          r.netBeforeTax - r.depreciationRecaptureTax - r.capitalGainsTax,
        );
        expect(
          closeRel(
            r.futureValueAtHorizon,
            r.netProceeds * Math.pow(1 + reinvRate, ctx.projectionYears),
            1e-9,
          ),
        ).toBe(true);
        return true;
      }),
    );
  });

  it('longTermGain is non-negative and clamps to zero past accumulated depreciation', () => {
    fc.assert(
      fc.property(sellContextArb, (ctx) => {
        const r = computeSellScenario(ctx);
        expect(r.longTermGain).toBeGreaterThanOrEqual(0);
        if (ctx.accumulatedDepreciation > r.gain) {
          expect(r.longTermGain).toBe(0);
        }
        return true;
      }),
    );
  });

  it('omitting any assumption field matches setting it to its default', () => {
    const fields: ReadonlyArray<readonly [keyof HoldSellAssumptions, number]> =
      [
        ['annualAppreciationRate', DEFAULT_APPRECIATION_RATE],
        ['annualRentGrowthRate', DEFAULT_RENT_GROWTH_RATE],
        ['agentCommissionRate', DEFAULT_AGENT_COMMISSION_RATE],
        ['saleClosingCostsRate', DEFAULT_SALE_CLOSING_COSTS_RATE],
        ['longTermCapGainsRate', DEFAULT_LONG_TERM_CAP_GAINS_RATE],
        ['depreciationRecaptureRate', DEFAULT_DEPRECIATION_RECAPTURE_RATE],
        ['reinvestmentReturnRate', DEFAULT_REINVESTMENT_RETURN_RATE],
      ];
    fc.assert(
      fc.property(baseSellContextArb, (base) => {
        const bare = computeSellScenario(base);
        for (const [field, value] of fields) {
          const withDefault = computeSellScenario({
            ...base,
            assumptions: { [field]: value },
          });
          expect(withDefault).toEqual(bare);
        }
        return true;
      }),
    );
  });

  it('canonical: typical sale', () => {
    const r = computeSellScenario({
      propertyValue: 400_000,
      mortgageBalance: 200_000,
      adjustedCostBasis: 300_000,
      accumulatedDepreciation: 40_000,
      projectionYears: 10,
    });
    expect(r.salePrice).toBe(400_000);
    expect(r.agentCommission).toBe(24_000);
    expect(r.saleClosingCosts).toBe(4_000);
    expect(r.netBeforeTax).toBe(172_000);
    expect(r.gain).toBe(100_000);
    expect(r.depreciationRecaptureTax).toBe(10_000);
    expect(r.longTermGain).toBe(60_000);
    expect(r.capitalGainsTax).toBe(9_000);
    expect(r.netProceeds).toBe(153_000);
    expect(r.futureValueAtHorizon).toBeCloseTo(
      153_000 * Math.pow(1.07, 10),
      6,
    );
  });

  it('canonical: loss case clamps the long-term gain and tax to zero', () => {
    const r = computeSellScenario({
      propertyValue: 250_000,
      mortgageBalance: 150_000,
      adjustedCostBasis: 300_000,
      accumulatedDepreciation: 40_000,
      projectionYears: 10,
    });
    expect(r.gain).toBe(-50_000);
    expect(r.longTermGain).toBe(0);
    expect(r.capitalGainsTax).toBe(0);
    expect(r.depreciationRecaptureTax).toBe(10_000);
    expect(r.netBeforeTax).toBe(82_500);
    expect(r.netProceeds).toBe(72_500);
  });
});

// ---------- §7.2 Hold scenario ----------

describe('computeHoldScenario', () => {
  it('throws on a non-positive projectionYears', () => {
    for (const projectionYears of [0, -1, -10]) {
      expect(() =>
        computeHoldScenario({
          propertyValue: 400_000,
          monthlyGrossRent: 2500,
          mortgageBalance: 300_000,
          monthlyPayment: 1945.79,
          monthlyRate: 0.005625,
          annualDepreciation: 11_636.36,
          projectionYears,
        }),
      ).toThrow();
    }
  });

  it('produces one 1-indexed row per projection year', () => {
    fc.assert(
      fc.property(holdContextArb, (ctx) => {
        const r = computeHoldScenario(ctx);
        expect(r.years.length).toBe(ctx.projectionYears);
        r.years.forEach((yr, i) => {
          expect(yr.year).toBe(i + 1);
        });
        return true;
      }),
    );
  });

  it('year-by-year display values match the §7.2 formulas', () => {
    fc.assert(
      fc.property(holdContextArb, (ctx) => {
        const r = computeHoldScenario(ctx);
        const a = ctx.assumptions ?? {};
        const apprRate = a.annualAppreciationRate ?? DEFAULT_APPRECIATION_RATE;
        const rentRate = a.annualRentGrowthRate ?? DEFAULT_RENT_GROWTH_RATE;
        const opexRate =
          ctx.operatingExpenseRate ?? DEFAULT_OPERATING_EXPENSE_RATE;
        const ads = ctx.monthlyPayment * 12;

        r.years.forEach((yr) => {
          const y = yr.year;
          expect(
            closeRel(
              yr.propertyValue,
              ctx.propertyValue * Math.pow(1 + apprRate, y),
              1e-9,
            ),
          ).toBe(true);
          expect(
            closeRel(
              yr.annualGrossRent,
              ctx.monthlyGrossRent * 12 * Math.pow(1 + rentRate, y),
              1e-9,
            ),
          ).toBe(true);
          expect(yr.operatingExpenses).toBe(yr.annualGrossRent * opexRate);
          expect(yr.netOperatingIncome).toBe(
            yr.annualGrossRent - yr.operatingExpenses,
          );
          expect(yr.cashFlowAnnual).toBe(yr.netOperatingIncome - ads);
          expect(yr.equity).toBe(yr.propertyValue - yr.mortgageBalance);
          expect(yr.totalHoldValue).toBe(
            yr.cumulativeCashFlow + yr.equity + yr.cumulativeTaxShield,
          );
        });
        return true;
      }),
    );
  });

  it('mortgage balance agrees with §2.4 balanceAtMonth at year * 12', () => {
    fc.assert(
      fc.property(holdContextArb, (ctx) => {
        const r = computeHoldScenario(ctx);
        r.years.forEach((yr) => {
          expect(yr.mortgageBalance).toBe(
            balanceAtMonth(
              ctx.mortgageBalance,
              ctx.monthlyRate,
              ctx.monthlyPayment,
              yr.year * 12,
            ),
          );
        });
        return true;
      }),
    );
  });

  it('cumulativeCashFlow is the running sum of cashFlowAnnual', () => {
    fc.assert(
      fc.property(holdContextArb, (ctx) => {
        const r = computeHoldScenario(ctx);
        let running = 0;
        r.years.forEach((yr) => {
          running += yr.cashFlowAnnual;
          expect(closeRel(yr.cumulativeCashFlow, running, 1e-6)).toBe(true);
        });
        return true;
      }),
    );
  });

  it('cumulative tax shield is linear when a marginal tax rate is supplied', () => {
    fc.assert(
      fc.property(holdContextArb, (ctx) => {
        const r = computeHoldScenario(ctx);
        const marginalTaxRate = ctx.assumptions?.marginalTaxRate;
        r.years.forEach((yr) => {
          if (marginalTaxRate === undefined) {
            expect(yr.cumulativeTaxShield).toBe(0);
          } else {
            expect(
              closeRel(
                yr.cumulativeTaxShield,
                ctx.annualDepreciation * marginalTaxRate * yr.year,
                1e-6,
              ),
            ).toBe(true);
          }
        });
        return true;
      }),
    );
  });

  it('omitting an assumption field matches setting it to its default', () => {
    fc.assert(
      fc.property(baseHoldContextArb, (base) => {
        const bare = computeHoldScenario(base);
        expect(
          computeHoldScenario({
            ...base,
            assumptions: { annualAppreciationRate: DEFAULT_APPRECIATION_RATE },
          }),
        ).toEqual(bare);
        expect(
          computeHoldScenario({
            ...base,
            assumptions: { annualRentGrowthRate: DEFAULT_RENT_GROWTH_RATE },
          }),
        ).toEqual(bare);
        expect(
          computeHoldScenario({
            ...base,
            operatingExpenseRate: DEFAULT_OPERATING_EXPENSE_RATE,
          }),
        ).toEqual(bare);
        return true;
      }),
    );
  });

  it('canonical: year-1 and year-10 totalHoldValue follow the formula', () => {
    const r = computeHoldScenario({
      propertyValue: 400_000,
      monthlyGrossRent: 2500,
      operatingExpenseRate: 0.4,
      mortgageBalance: 300_000,
      monthlyPayment: 1945.79,
      monthlyRate: 0.005625,
      annualDepreciation: 11_636.36,
      projectionYears: 10,
      assumptions: { marginalTaxRate: 0.32 },
    });
    expect(r.years.length).toBe(10);
    const y1 = r.years[0];
    const y10 = r.years[9];
    expect(y1).toBeDefined();
    expect(y10).toBeDefined();
    if (!y1 || !y10) return;
    expect(y1.totalHoldValue).toBe(
      y1.cumulativeCashFlow + y1.equity + y1.cumulativeTaxShield,
    );
    expect(y10.totalHoldValue).toBe(
      y10.cumulativeCashFlow + y10.equity + y10.cumulativeTaxShield,
    );
    expect(y1.cumulativeTaxShield).toBeCloseTo(11_636.36 * 0.32 * 1, 6);
    expect(y10.cumulativeTaxShield).toBeCloseTo(11_636.36 * 0.32 * 10, 6);
  });
});

// ---------- §7.3 Hold vs sell comparison ----------

describe('compareHoldVsSell', () => {
  it('throws when the two contexts disagree on projectionYears', () => {
    const sell: SellScenarioContext = {
      propertyValue: 400_000,
      mortgageBalance: 200_000,
      adjustedCostBasis: 300_000,
      accumulatedDepreciation: 40_000,
      projectionYears: 5,
    };
    const hold: HoldScenarioContext = {
      propertyValue: 400_000,
      monthlyGrossRent: 2500,
      mortgageBalance: 300_000,
      monthlyPayment: 1945.79,
      monthlyRate: 0.005625,
      annualDepreciation: 11_636.36,
      projectionYears: 7,
    };
    expect(() => compareHoldVsSell({ sell, hold })).toThrow();
  });

  it('per-year structural laws hold', () => {
    fc.assert(
      fc.property(holdVsSellContextArb, (ctx) => {
        const result = compareHoldVsSell(ctx);
        const reinvRate =
          ctx.sell.assumptions?.reinvestmentReturnRate ??
          DEFAULT_REINVESTMENT_RETURN_RATE;
        expect(result.years.length).toBe(ctx.sell.projectionYears);
        result.years.forEach((cmp, i) => {
          const holdYear = result.hold.years[i];
          if (!holdYear) return false;
          expect(cmp.year).toBe(i + 1);
          expect(cmp.holdValue).toBe(holdYear.totalHoldValue);
          expect(
            closeRel(
              cmp.sellValueAtYear,
              result.sell.netProceeds * Math.pow(1 + reinvRate, cmp.year),
              1e-9,
            ),
          ).toBe(true);
          expect(cmp.difference).toBe(cmp.holdValue - cmp.sellValueAtYear);
          return true;
        });
        return true;
      }),
    );
  });

  it('crossover year is the first year hold overtakes sell, if any', () => {
    fc.assert(
      fc.property(holdVsSellContextArb, (ctx) => {
        const result = compareHoldVsSell(ctx);
        if (result.crossoverYear === null) {
          return result.years.every((cmp) => cmp.difference <= 0);
        }
        const crossover = result.crossoverYear;
        const crossoverRow = result.years[crossover - 1];
        if (!crossoverRow) return false;
        expect(crossoverRow.difference).toBeGreaterThan(0);
        for (const cmp of result.years) {
          if (cmp.year < crossover) {
            expect(cmp.difference).toBeLessThanOrEqual(0);
          }
        }
        return true;
      }),
    );
  });

  it('canonical: a strong-appreciation hold eventually crosses over', () => {
    const result = compareHoldVsSell({
      sell: {
        propertyValue: 400_000,
        mortgageBalance: 100_000,
        adjustedCostBasis: 350_000,
        accumulatedDepreciation: 50_000,
        projectionYears: 20,
      },
      hold: {
        propertyValue: 400_000,
        monthlyGrossRent: 3000,
        operatingExpenseRate: 0.3,
        mortgageBalance: 100_000,
        monthlyPayment: 600,
        monthlyRate: 0.04 / 12,
        annualDepreciation: 10_000,
        projectionYears: 20,
        assumptions: {
          annualAppreciationRate: 0.06,
          annualRentGrowthRate: 0.03,
        },
      },
    });
    expect(result.crossoverYear).not.toBeNull();
  });

  it('canonical: a weak hold against a strong sell never crosses over', () => {
    const result = compareHoldVsSell({
      sell: {
        propertyValue: 500_000,
        mortgageBalance: 50_000,
        adjustedCostBasis: 480_000,
        accumulatedDepreciation: 10_000,
        projectionYears: 4,
        assumptions: { reinvestmentReturnRate: 0.1 },
      },
      hold: {
        propertyValue: 200_000,
        monthlyGrossRent: 800,
        operatingExpenseRate: 0.5,
        mortgageBalance: 190_000,
        monthlyPayment: 3000,
        monthlyRate: 0.08 / 12,
        annualDepreciation: 4000,
        projectionYears: 4,
        assumptions: {
          annualAppreciationRate: 0.01,
          annualRentGrowthRate: 0,
        },
      },
    });
    expect(result.crossoverYear).toBeNull();
  });
});
