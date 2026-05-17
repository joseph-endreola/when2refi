// MATH.md §7 Hold/Sell Analysis.
//
// Three pure functions:
//
//   computeSellScenario   one-shot calculation of sale proceeds net of
//                         agent commission, sale closing costs, mortgage
//                         payoff, depreciation recapture, and capital
//                         gains tax, plus the future value of those
//                         proceeds reinvested for the projection horizon.
//   computeHoldScenario   year-by-year projection of property value,
//                         gross rent, operating expenses, NOI, cash flow,
//                         mortgage balance (via §2.4 balanceAtMonth),
//                         equity, cumulative cash flow, cumulative
//                         depreciation tax shield (when marginal tax
//                         rate provided), and totalHoldValue.
//   compareHoldVsSell     orchestrates both, projects the sell future
//                         value at each year (not just the horizon),
//                         computes year-by-year differences, and
//                         identifies the crossover year (first year
//                         where hold outperforms sell) if any.
//
// Inputs are accepted as already-computed: adjustedCostBasis and
// accumulatedDepreciation for the sell scenario, annualDepreciation for
// the hold scenario. Use §6's computeDepreciation upstream to produce
// these values; this module does not re-derive them.
//
// All assumption defaults are exposed as named constants. Marginal tax
// rate is optional; when absent, the hold scenario's cumulativeTaxShield
// stays at zero throughout the projection. Per MATH.md §7, all
// assumptions are UI state, not stored in D1.

import type { Dollars, AnnualRate, MonthlyRate } from './units';
import type { Months } from './amortization';
import { balanceAtMonth } from './amortization.js';
import { DEFAULT_OPERATING_EXPENSE_RATE } from './investment-metrics.js';

// ---------- Constants ----------

/** Default annual appreciation rate per MATH.md §7: 3%. */
export const DEFAULT_APPRECIATION_RATE: AnnualRate = 0.03;

/** Default annual rent growth rate per MATH.md §7: 2%. */
export const DEFAULT_RENT_GROWTH_RATE: AnnualRate = 0.02;

/** Default agent commission on sale per MATH.md §7: 6% of sale price. */
export const DEFAULT_AGENT_COMMISSION_RATE = 0.06;

/** Default sale closing costs per MATH.md §7: 1% of sale price. */
export const DEFAULT_SALE_CLOSING_COSTS_RATE = 0.01;

/** Default long-term capital gains rate per MATH.md §7: 15%. */
export const DEFAULT_LONG_TERM_CAP_GAINS_RATE = 0.15;

/**
 * Default depreciation recapture rate per MATH.md §7: 25%.
 * IRS §1250 maximum recapture rate for real property.
 */
export const DEFAULT_DEPRECIATION_RECAPTURE_RATE = 0.25;

/**
 * Default reinvestment return for the sell scenario per MATH.md §7: 7%.
 * Caller may pass a different rate (for example, matching the
 * assumedReturnRate from cash-out analysis).
 */
export const DEFAULT_REINVESTMENT_RETURN_RATE: AnnualRate = 0.07;

// ---------- Shared assumptions ----------

/**
 * User-adjustable assumptions for the hold/sell projection. All fields
 * are optional; absent fields fall back to the DEFAULT_* constants.
 *
 * The sell scenario reads agentCommissionRate, saleClosingCostsRate,
 * longTermCapGainsRate, depreciationRecaptureRate, and
 * reinvestmentReturnRate. The hold scenario reads
 * annualAppreciationRate, annualRentGrowthRate, and marginalTaxRate.
 * Unused fields on either scenario are simply ignored.
 */
export interface HoldSellAssumptions {
  readonly annualAppreciationRate?: AnnualRate;
  readonly annualRentGrowthRate?: AnnualRate;
  readonly agentCommissionRate?: number;
  readonly saleClosingCostsRate?: number;
  readonly longTermCapGainsRate?: number;
  readonly depreciationRecaptureRate?: number;
  /**
   * Marginal income tax rate. Optional per MATH.md §7. When provided,
   * the hold scenario includes the depreciation tax shield in
   * cumulativeTaxShield and totalHoldValue.
   */
  readonly marginalTaxRate?: number;
  readonly reinvestmentReturnRate?: AnnualRate;
}

// ---------- Sell scenario ----------

export interface SellScenarioContext {
  /** Today's estimated property value, treated as the sale price. */
  readonly propertyValue: Dollars;
  /** Current mortgage balance, paid off at closing. */
  readonly mortgageBalance: Dollars;
  /**
   * Adjusted cost basis from computeDepreciation. Used for gain
   * calculation: gain = salePrice - adjustedCostBasis.
   */
  readonly adjustedCostBasis: Dollars;
  /**
   * Accumulated depreciation from computeDepreciation. Used for
   * depreciation recapture tax.
   */
  readonly accumulatedDepreciation: Dollars;
  /** Projection horizon in years. UI defaults: 5, 7, 10. */
  readonly projectionYears: number;
  readonly assumptions?: HoldSellAssumptions;
}

export interface SellScenarioResult {
  /** Sale price (equals propertyValue). */
  readonly salePrice: Dollars;
  /** salePrice * agentCommissionRate. */
  readonly agentCommission: Dollars;
  /** salePrice * saleClosingCostsRate. */
  readonly saleClosingCosts: Dollars;
  /** salePrice - agentCommission - saleClosingCosts - mortgageBalance. */
  readonly netBeforeTax: Dollars;
  /** salePrice - adjustedCostBasis. May be negative. */
  readonly gain: Dollars;
  /** accumulatedDepreciation * depreciationRecaptureRate. */
  readonly depreciationRecaptureTax: Dollars;
  /** max(0, gain - accumulatedDepreciation). */
  readonly longTermGain: Dollars;
  /** longTermGain * longTermCapGainsRate. */
  readonly capitalGainsTax: Dollars;
  /** netBeforeTax - depreciationRecaptureTax - capitalGainsTax. */
  readonly netProceeds: Dollars;
  /** netProceeds * (1 + reinvestmentReturnRate)^projectionYears. */
  readonly futureValueAtHorizon: Dollars;
}

/**
 * §7.1 sell scenario. One-shot computation of proceeds from selling
 * today, net of commissions, closing costs, and tax, plus the future
 * value of those proceeds reinvested for the projection horizon.
 *
 * Throws on non-positive projectionYears.
 */
export function computeSellScenario(
  ctx: SellScenarioContext,
): SellScenarioResult {
  if (ctx.projectionYears <= 0) {
    throw new Error('computeSellScenario: projectionYears must be positive');
  }
  const a = ctx.assumptions ?? {};
  const agentCommissionRate =
    a.agentCommissionRate ?? DEFAULT_AGENT_COMMISSION_RATE;
  const saleClosingCostsRate =
    a.saleClosingCostsRate ?? DEFAULT_SALE_CLOSING_COSTS_RATE;
  const longTermCapGainsRate =
    a.longTermCapGainsRate ?? DEFAULT_LONG_TERM_CAP_GAINS_RATE;
  const depreciationRecaptureRate =
    a.depreciationRecaptureRate ?? DEFAULT_DEPRECIATION_RECAPTURE_RATE;
  const reinvestmentReturnRate =
    a.reinvestmentReturnRate ?? DEFAULT_REINVESTMENT_RETURN_RATE;

  const salePrice = ctx.propertyValue;
  const agentCommission = salePrice * agentCommissionRate;
  const saleClosingCosts = salePrice * saleClosingCostsRate;
  const netBeforeTax =
    salePrice - agentCommission - saleClosingCosts - ctx.mortgageBalance;

  const gain = salePrice - ctx.adjustedCostBasis;
  const depreciationRecaptureTax =
    ctx.accumulatedDepreciation * depreciationRecaptureRate;
  const longTermGain = Math.max(0, gain - ctx.accumulatedDepreciation);
  const capitalGainsTax = longTermGain * longTermCapGainsRate;

  const netProceeds =
    netBeforeTax - depreciationRecaptureTax - capitalGainsTax;
  const futureValueAtHorizon =
    netProceeds * Math.pow(1 + reinvestmentReturnRate, ctx.projectionYears);

  return {
    salePrice,
    agentCommission,
    saleClosingCosts,
    netBeforeTax,
    gain,
    depreciationRecaptureTax,
    longTermGain,
    capitalGainsTax,
    netProceeds,
    futureValueAtHorizon,
  };
}

// ---------- Hold scenario ----------

export interface HoldScenarioContext {
  /** Today's estimated property value. */
  readonly propertyValue: Dollars;
  /** Current monthly gross rent. */
  readonly monthlyGrossRent: Dollars;
  /**
   * Operating expense rate. Defaults to DEFAULT_OPERATING_EXPENSE_RATE
   * (0.40). Held constant across the projection.
   */
  readonly operatingExpenseRate?: number;
  /** Current mortgage balance. */
  readonly mortgageBalance: Dollars;
  /**
   * Current monthly P&I payment, fixed for the projection. Assumes a
   * fixed-rate loan; the spec calls out ADS as "fixed since fixed rate."
   */
  readonly monthlyPayment: Dollars;
  /**
   * Current loan rate, decimal monthly. Used by balanceAtMonth to
   * project the loan balance forward at each year boundary.
   */
  readonly monthlyRate: MonthlyRate;
  /**
   * Annual depreciation from computeDepreciation. Constant per year
   * under straight-line.
   */
  readonly annualDepreciation: Dollars;
  /** Projection horizon in years. */
  readonly projectionYears: number;
  readonly assumptions?: HoldSellAssumptions;
}

export interface HoldYearProjection {
  /** 1-indexed year of projection. */
  readonly year: number;
  /** propertyValue * (1 + annualAppreciationRate)^year. */
  readonly propertyValue: Dollars;
  /** monthlyGrossRent * 12 * (1 + annualRentGrowthRate)^year. */
  readonly annualGrossRent: Dollars;
  /** annualGrossRent * operatingExpenseRate. */
  readonly operatingExpenses: Dollars;
  /** annualGrossRent - operatingExpenses. */
  readonly netOperatingIncome: Dollars;
  /** netOperatingIncome - ADS. ADS fixed throughout. */
  readonly cashFlowAnnual: Dollars;
  /** balanceAtMonth at year * 12. */
  readonly mortgageBalance: Dollars;
  /** propertyValue - mortgageBalance for this year. */
  readonly equity: Dollars;
  /** Sum of cashFlowAnnual from year 1 through this year. */
  readonly cumulativeCashFlow: Dollars;
  /**
   * annualDepreciation * marginalTaxRate * year. Zero when
   * marginalTaxRate is not provided.
   */
  readonly cumulativeTaxShield: Dollars;
  /** cumulativeCashFlow + equity + cumulativeTaxShield. */
  readonly totalHoldValue: Dollars;
}

export interface HoldScenarioResult {
  readonly years: ReadonlyArray<HoldYearProjection>;
}

/**
 * §7.2 hold scenario. Year-by-year projection of property value, rent
 * income, operating expenses, NOI, cash flow, mortgage balance,
 * equity, cumulative cash flow, cumulative depreciation tax shield,
 * and total hold value.
 *
 * Annual debt service is fixed at monthlyPayment * 12 (fixed-rate loan
 * assumption). The mortgage balance projection uses §2.4 balanceAtMonth
 * evaluated at year * 12 for each year.
 *
 * Throws on non-positive projectionYears.
 */
export function computeHoldScenario(
  ctx: HoldScenarioContext,
): HoldScenarioResult {
  if (ctx.projectionYears <= 0) {
    throw new Error('computeHoldScenario: projectionYears must be positive');
  }
  const a = ctx.assumptions ?? {};
  const annualAppreciationRate =
    a.annualAppreciationRate ?? DEFAULT_APPRECIATION_RATE;
  const annualRentGrowthRate =
    a.annualRentGrowthRate ?? DEFAULT_RENT_GROWTH_RATE;
  const operatingExpenseRate =
    ctx.operatingExpenseRate ?? DEFAULT_OPERATING_EXPENSE_RATE;
  const marginalTaxRate = a.marginalTaxRate ?? null;

  const annualDebtService = ctx.monthlyPayment * 12;
  const annualTaxShield =
    marginalTaxRate !== null
      ? ctx.annualDepreciation * marginalTaxRate
      : 0;

  const years: HoldYearProjection[] = [];
  let cumulativeCashFlow = 0;
  for (let y = 1; y <= ctx.projectionYears; y++) {
    const propertyValue =
      ctx.propertyValue * Math.pow(1 + annualAppreciationRate, y);
    const annualGrossRent =
      ctx.monthlyGrossRent * 12 * Math.pow(1 + annualRentGrowthRate, y);
    const operatingExpenses = annualGrossRent * operatingExpenseRate;
    const netOperatingIncome = annualGrossRent - operatingExpenses;
    const cashFlowAnnual = netOperatingIncome - annualDebtService;
    const mortgageBalance = balanceAtMonth(
      ctx.mortgageBalance,
      ctx.monthlyRate,
      ctx.monthlyPayment,
      y * 12,
    );
    const equity = propertyValue - mortgageBalance;
    cumulativeCashFlow += cashFlowAnnual;
    const cumulativeTaxShield = annualTaxShield * y;
    const totalHoldValue = cumulativeCashFlow + equity + cumulativeTaxShield;

    years.push({
      year: y,
      propertyValue,
      annualGrossRent,
      operatingExpenses,
      netOperatingIncome,
      cashFlowAnnual,
      mortgageBalance,
      equity,
      cumulativeCashFlow,
      cumulativeTaxShield,
      totalHoldValue,
    });
  }

  return { years };
}

// ---------- Hold vs sell comparison ----------

export interface HoldVsSellContext {
  readonly sell: SellScenarioContext;
  readonly hold: HoldScenarioContext;
}

export interface HoldVsSellYearComparison {
  readonly year: number;
  /** From the hold projection at this year. */
  readonly holdValue: Dollars;
  /** netProceeds * (1 + reinvestmentReturnRate)^year. */
  readonly sellValueAtYear: Dollars;
  /** holdValue - sellValueAtYear. Positive when hold outperforms this year. */
  readonly difference: Dollars;
}

export interface HoldVsSellResult {
  readonly years: ReadonlyArray<HoldVsSellYearComparison>;
  /**
   * First year where holdValue > sellValueAtYear. Null when sell
   * outperforms throughout the projection horizon (no crossover).
   */
  readonly crossoverYear: number | null;
  readonly sell: SellScenarioResult;
  readonly hold: HoldScenarioResult;
}

/**
 * §7.3 hold vs sell comparison. Runs both scenarios, projects the sell
 * future value at each year (not only the horizon), computes the
 * year-by-year difference, and identifies the first crossover year
 * (the first year where hold outperforms sell) if any.
 *
 * Both sell and hold contexts must declare the same projectionYears;
 * throws otherwise. The reinvestmentReturnRate for the year-by-year
 * sell FV projection is read from sell.assumptions, falling back to
 * DEFAULT_REINVESTMENT_RETURN_RATE.
 */
export function compareHoldVsSell(
  ctx: HoldVsSellContext,
): HoldVsSellResult {
  if (ctx.sell.projectionYears !== ctx.hold.projectionYears) {
    throw new Error(
      'compareHoldVsSell: sell.projectionYears and hold.projectionYears must match',
    );
  }
  const sell = computeSellScenario(ctx.sell);
  const hold = computeHoldScenario(ctx.hold);
  const reinvestmentRate =
    ctx.sell.assumptions?.reinvestmentReturnRate ??
    DEFAULT_REINVESTMENT_RETURN_RATE;

  const years: HoldVsSellYearComparison[] = [];
  let crossoverYear: number | null = null;
  for (let y = 1; y <= ctx.sell.projectionYears; y++) {
    const holdYear = hold.years[y - 1];
    if (!holdYear) {
      throw new Error(
        `compareHoldVsSell: missing hold projection for year ${y}`,
      );
    }
    const sellValueAtYear =
      sell.netProceeds * Math.pow(1 + reinvestmentRate, y);
    const difference = holdYear.totalHoldValue - sellValueAtYear;
    if (crossoverYear === null && difference > 0) {
      crossoverYear = y;
    }
    years.push({
      year: y,
      holdValue: holdYear.totalHoldValue,
      sellValueAtYear,
      difference,
    });
  }

  return {
    years,
    crossoverYear,
    sell,
    hold,
  };
}
