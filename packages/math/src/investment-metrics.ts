// Investment property metrics for MATH.md §6.
//
// Two independent functions:
//
//   computeIncomeMetrics    income, cash flow, yield ratios, equity,
//                           return on wealth. Always computable for an
//                           investment property with rent data.
//   computeDepreciation     IRS straight-line depreciation, accumulated
//                           depreciation, adjusted cost basis. Requires
//                           purchase price and date.
//
// Splitting these keeps each function total over its domain. The caller
// composes them when both apply.
//
// Ratios that may not apply (DSCR when there is no debt; ROW when there
// is no positive equity) are typed `number | null` so the caller cannot
// silently divide-by-zero in the UI layer.

import type { Dollars, AnnualRate } from './units';
import type { Months } from './amortization';
import { monthsBetween } from './amortization.js';

// ---------- Constants ----------

/**
 * Default operating expense rate per MATH.md §6: 40% of annual gross rent.
 * Typical range 30%-50% depending on property type and management.
 * UI-adjustable per property.
 */
export const DEFAULT_OPERATING_EXPENSE_RATE = 0.40;

/**
 * Default structure-value ratio: 80% of purchase price treated as the
 * depreciable structure, 20% as non-depreciable land. A common safe-harbor
 * default. Actual allocation should follow appraisal or county tax
 * records when available; the API exposes structureRatio for override.
 */
export const STRUCTURE_VALUE_RATIO = 0.80;

/**
 * IRS residential rental property depreciation life: 27.5 years
 * straight-line per IRS Publication 527. Commercial real property uses
 * 39 years. This module defaults to residential; the API exposes
 * lifeYears for override.
 */
export const DEPRECIATION_LIFE_YEARS = 27.5;

/**
 * DSCR cash-flow warning threshold per MATH.md §6. Property is cash-flow
 * negative when DSCR < 1.00.
 */
export const DSCR_CASH_FLOW_WARNING_THRESHOLD = 1.00;

/**
 * DSCR loan eligibility threshold per MATH.md §6. Most DSCR-loan
 * underwriters require DSCR >= 1.25 to qualify.
 */
export const DSCR_LOAN_ELIGIBILITY_THRESHOLD = 1.25;

// ---------- Income, cash flow, and yield metrics ----------

export interface IncomeMetricsContext {
  /** Current estimated property value. */
  readonly propertyValue: Dollars;
  /** Current mortgage balance. May be zero (paid-off property). */
  readonly mortgageBalance: Dollars;
  /**
   * Current P&I monthly payment, excluding taxes and insurance. May be
   * zero (paid-off property).
   */
  readonly monthlyPayment: Dollars;
  /**
   * Monthly gross rent. Required per MATH.md §6 ("requires
   * monthly_gross_rent_cents to be populated").
   */
  readonly monthlyGrossRent: Dollars;
  /**
   * Operating expense rate as a decimal of annual gross rent.
   * Defaults to DEFAULT_OPERATING_EXPENSE_RATE (0.40).
   */
  readonly operatingExpenseRate?: number;
}

export interface IncomeMetrics {
  /** monthlyGrossRent × 12. */
  readonly annualGrossRent: Dollars;
  /** annualGrossRent × operatingExpenseRate. */
  readonly operatingExpenses: Dollars;
  /** annualGrossRent - operatingExpenses. */
  readonly netOperatingIncome: Dollars;
  /** monthlyPayment × 12 (annual debt service). */
  readonly annualDebtService: Dollars;
  /** netOperatingIncome - annualDebtService. */
  readonly cashFlowAnnual: Dollars;
  /** cashFlowAnnual / 12. */
  readonly cashFlowMonthly: Dollars;
  /**
   * Capitalization rate (NOI / propertyValue) as decimal annual.
   * Use annualRateToBps from ./units to convert for storage.
   */
  readonly capRate: AnnualRate;
  /** propertyValue / annualGrossRent. */
  readonly grossRentMultiplier: number;
  /**
   * Debt service coverage ratio (NOI / ADS).
   * Null when annualDebtService is zero (paid-off property has no
   * debt to service); a paid-off property still has cap rate, GRM, ROW,
   * etc., but DSCR does not apply.
   */
  readonly debtServiceCoverage: number | null;
  /** propertyValue - mortgageBalance. May be negative if over-leveraged. */
  readonly equity: Dollars;
  /**
   * Return on wealth (cashFlowAnnual / equity) as decimal annual.
   * Null when equity is non-positive (over-leveraged or break-even
   * property); ROW is undefined when there is no equity to return on.
   * Use annualRateToBps from ./units to convert for storage.
   */
  readonly returnOnWealth: AnnualRate | null;
}

/**
 * Compute income, cash flow, and yield metrics for an investment property.
 * MATH.md §6.
 *
 * Required: propertyValue > 0, monthlyGrossRent > 0. mortgageBalance and
 * monthlyPayment may be zero (paid-off property), in which case
 * debtServiceCoverage is null.
 *
 * Throws on non-positive propertyValue or non-positive monthlyGrossRent.
 */
export function computeIncomeMetrics(
  ctx: IncomeMetricsContext,
): IncomeMetrics {
  if (ctx.propertyValue <= 0) {
    throw new Error(
      'computeIncomeMetrics: propertyValue must be positive',
    );
  }
  if (ctx.monthlyGrossRent <= 0) {
    throw new Error(
      'computeIncomeMetrics: monthlyGrossRent must be positive',
    );
  }
  const rate = ctx.operatingExpenseRate ?? DEFAULT_OPERATING_EXPENSE_RATE;
  const annualGrossRent = ctx.monthlyGrossRent * 12;
  const operatingExpenses = annualGrossRent * rate;
  const netOperatingIncome = annualGrossRent - operatingExpenses;
  const annualDebtService = ctx.monthlyPayment * 12;
  const cashFlowAnnual = netOperatingIncome - annualDebtService;
  const equity = ctx.propertyValue - ctx.mortgageBalance;
  return {
    annualGrossRent,
    operatingExpenses,
    netOperatingIncome,
    annualDebtService,
    cashFlowAnnual,
    cashFlowMonthly: cashFlowAnnual / 12,
    capRate: netOperatingIncome / ctx.propertyValue,
    grossRentMultiplier: ctx.propertyValue / annualGrossRent,
    debtServiceCoverage:
      annualDebtService > 0 ? netOperatingIncome / annualDebtService : null,
    equity,
    returnOnWealth: equity > 0 ? cashFlowAnnual / equity : null,
  };
}

// ---------- Depreciation ----------

export interface DepreciationContext {
  /** Original purchase price (cost basis). */
  readonly purchasePrice: Dollars;
  /** Purchase date in YYYY-MM-DD format. */
  readonly purchaseDate: string;
  /**
   * Reference date in YYYY-MM-DD format, typically today. Pass-in rather
   * than reading the clock internally keeps the function deterministic.
   */
  readonly asOfDate: string;
  /**
   * Structure-value ratio override. Defaults to STRUCTURE_VALUE_RATIO
   * (0.80). Use the actual appraisal or tax-record allocation when
   * available.
   */
  readonly structureRatio?: number;
  /**
   * Depreciation life override in years. Defaults to
   * DEPRECIATION_LIFE_YEARS (27.5) for residential rental. Use 39 for
   * commercial real property.
   */
  readonly lifeYears?: number;
}

export interface DepreciationMetrics {
  /** purchasePrice × structureRatio. The depreciable basis. */
  readonly structureValue: Dollars;
  /** structureValue / lifeYears. Annual straight-line depreciation. */
  readonly annualDepreciation: Dollars;
  /** Calendar months between purchaseDate and asOfDate, floored. */
  readonly monthsHeld: Months;
  /** monthsHeld / 12 (fractional). */
  readonly yearsHeld: number;
  /**
   * min(annualDepreciation × yearsHeld, structureValue).
   * Capped at the structure value because depreciation cannot exceed
   * the depreciable basis.
   */
  readonly accumulatedDepreciation: Dollars;
  /**
   * purchasePrice - accumulatedDepreciation. Used for capital gains
   * calculation on sale per MATH.md §7.
   */
  readonly adjustedCostBasis: Dollars;
}

/**
 * Compute IRS straight-line depreciation for a residential rental property.
 * MATH.md §6.
 *
 * Defaults assume residential rental (27.5-year life, 80/20
 * structure/land allocation). Override structureRatio and lifeYears for
 * commercial or for properties with documented allocation that differs
 * from the default.
 *
 * If asOfDate is before purchaseDate, monthsBetween returns 0 (per its
 * contract), yielding zero accumulated depreciation. That is the
 * correct outcome for a not-yet-held property.
 *
 * Throws on non-positive purchasePrice or non-positive lifeYears.
 * Throws via monthsBetween on malformed date strings.
 */
export function computeDepreciation(
  ctx: DepreciationContext,
): DepreciationMetrics {
  if (ctx.purchasePrice <= 0) {
    throw new Error(
      'computeDepreciation: purchasePrice must be positive',
    );
  }
  const structureRatio = ctx.structureRatio ?? STRUCTURE_VALUE_RATIO;
  const lifeYears = ctx.lifeYears ?? DEPRECIATION_LIFE_YEARS;
  if (lifeYears <= 0) {
    throw new Error(
      'computeDepreciation: lifeYears must be positive',
    );
  }
  const structureValue = ctx.purchasePrice * structureRatio;
  const annualDepreciation = structureValue / lifeYears;
  const monthsHeld = monthsBetween(ctx.purchaseDate, ctx.asOfDate);
  const yearsHeld = monthsHeld / 12;
  const accumulatedDepreciation = Math.min(
    annualDepreciation * yearsHeld,
    structureValue,
  );
  return {
    structureValue,
    annualDepreciation,
    monthsHeld,
    yearsHeld,
    accumulatedDepreciation,
    adjustedCostBasis: ctx.purchasePrice - accumulatedDepreciation,
  };
}
