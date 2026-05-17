// MATH.md §5.6 Tax Optimization.
//
// Informational display only. There is no backwards calculation and no
// rate solve here: §5.6 takes current loan facts and reports the tax
// picture as it stands. Per the spec, every result carries the mandatory
// tax disclaimer — it is a field on the result so a caller cannot render
// the numbers without it.
//
// Two functions, one per property-type branch of §5.6:
//
//   computePrimaryResidenceTax   mortgage-interest deduction, subject to
//                                the $750k IRS balance cap.
//   computeInvestmentTax         interest + depreciation tax shield for
//                                investment / multi_family property.
//
// annual_interest is the exact §2.5 amortization sum (annualInterest from
// ./amortization), not the B × r_m × 12 display approximation — §2.5
// directs the tax output to use the exact schedule.

import type { Dollars, MonthlyRate } from './units';
import { annualInterest } from './amortization.js';
import {
  STRUCTURE_VALUE_RATIO,
  DEPRECIATION_LIFE_YEARS,
  computeDepreciation,
} from './investment-metrics.js';

// ---------- Constants ----------

/**
 * Mandatory tax disclaimer per MATH.md §5.6. Surfaced on every result so
 * it cannot be omitted from a render ("no exceptions").
 */
export const TAX_DISCLAIMER =
  'This is for informational purposes only and does not constitute tax ' +
  'advice. Consult a qualified tax professional for guidance specific to ' +
  'your situation.';

/**
 * IRS mortgage-interest deduction balance cap: $750,000 per MATH.md §5.6.
 * Interest on balance above this cap is not deductible; deductible
 * interest is pro-rated by cap / balance.
 */
export const DEDUCTIBLE_BALANCE_CAP: Dollars = 750_000;

/**
 * Depreciation recapture display note per MATH.md §5.6. Display only —
 * no recapture amount is calculated here.
 */
export const DEPRECIATION_RECAPTURE_NOTE =
  'Note: accumulated depreciation is subject to 25% recapture tax upon sale.';

/**
 * 2024 federal standard deduction figures, in dollars, per MATH.md §5.6.
 * Itemizing only benefits the borrower when total itemized deductions
 * exceed the filing-status figure. Display aid; not used in any formula.
 */
export const STANDARD_DEDUCTION_2024 = {
  single: 14_600 as Dollars,
  married: 29_200 as Dollars,
} as const;

// ---------- Shared validation ----------

function assertValidLoanFacts(
  fn: string,
  mortgageBalance: Dollars,
  marginalTaxRate: number | undefined,
): void {
  if (mortgageBalance < 0) {
    throw new Error(`${fn}: mortgageBalance must not be negative`);
  }
  if (
    marginalTaxRate !== undefined &&
    (marginalTaxRate < 0 || marginalTaxRate > 1)
  ) {
    throw new Error(`${fn}: marginalTaxRate must be within [0, 1]`);
  }
}

// ---------- §5.6 Primary residence ----------

export interface PrimaryResidenceTaxContext {
  /** Current mortgage balance. */
  readonly mortgageBalance: Dollars;
  /** Current monthly rate (decimal). */
  readonly monthlyRate: MonthlyRate;
  /** Current P&I monthly payment, excluding taxes and insurance. */
  readonly monthlyPayment: Dollars;
  /**
   * Marginal tax rate as a decimal (e.g. 0.24). Optional: when absent,
   * estimatedTaxBenefit is null — the deduction is still reported, only
   * the dollar benefit cannot be estimated without the rate.
   */
  readonly marginalTaxRate?: number;
}

export interface PrimaryResidenceTaxResult {
  /** Mandatory §5.6 disclaimer. Always present. */
  readonly disclaimer: string;
  /** Exact §2.5 annual interest over the next 12 months. */
  readonly annualInterest: Dollars;
  /** The $750k IRS deduction balance cap (DEDUCTIBLE_BALANCE_CAP). */
  readonly deductibleBalanceCap: Dollars;
  /** True when mortgageBalance <= deductibleBalanceCap. */
  readonly fullyDeductible: boolean;
  /**
   * Deductible mortgage interest. Equals annualInterest when fully
   * deductible; otherwise pro-rated by cap / mortgageBalance.
   */
  readonly deductibleInterest: Dollars;
  /**
   * deductibleInterest * marginalTaxRate. Null when marginalTaxRate was
   * not provided.
   */
  readonly estimatedTaxBenefit: Dollars | null;
}

/**
 * §5.6 primary-residence tax optimization.
 *
 *   annual_interest     = §2.5 exact amortization sum
 *   deductible_interest = annual_interest                    (balance <= cap)
 *                       = annual_interest × (cap / balance)  (balance >  cap)
 *   tax_benefit         = deductible_interest × marginal_tax_rate
 *
 * Informational only. Deductibility applies only if the borrower
 * itemizes; see STANDARD_DEDUCTION_2024 for the threshold.
 *
 * Throws on a negative mortgageBalance, or a marginalTaxRate outside
 * [0, 1] when provided.
 */
export function computePrimaryResidenceTax(
  ctx: PrimaryResidenceTaxContext,
): PrimaryResidenceTaxResult {
  assertValidLoanFacts(
    'computePrimaryResidenceTax',
    ctx.mortgageBalance,
    ctx.marginalTaxRate,
  );
  const ai = annualInterest(
    ctx.mortgageBalance,
    ctx.monthlyRate,
    ctx.monthlyPayment,
  );
  const fullyDeductible = ctx.mortgageBalance <= DEDUCTIBLE_BALANCE_CAP;
  const deductibleInterest = fullyDeductible
    ? ai
    : ai * (DEDUCTIBLE_BALANCE_CAP / ctx.mortgageBalance);
  const estimatedTaxBenefit =
    ctx.marginalTaxRate !== undefined
      ? deductibleInterest * ctx.marginalTaxRate
      : null;
  return {
    disclaimer: TAX_DISCLAIMER,
    annualInterest: ai,
    deductibleBalanceCap: DEDUCTIBLE_BALANCE_CAP,
    fullyDeductible,
    deductibleInterest,
    estimatedTaxBenefit,
  };
}

// ---------- §5.6 Investment / multi_family ----------

/**
 * Purchase records for exact depreciation. When present on the context,
 * depreciation is computed from the actual cost basis and holding
 * period; when absent, depreciation is estimated from current value.
 */
export interface InvestmentTaxPurchaseInfo {
  /** Original purchase price (cost basis). */
  readonly purchasePrice: Dollars;
  /** Purchase date in YYYY-MM-DD format. */
  readonly purchaseDate: string;
  /** Reference date in YYYY-MM-DD format, typically today. */
  readonly asOfDate: string;
}

export interface InvestmentTaxContext {
  /** Current mortgage balance. */
  readonly mortgageBalance: Dollars;
  /** Current monthly rate (decimal). */
  readonly monthlyRate: MonthlyRate;
  /** Current P&I monthly payment, excluding taxes and insurance. */
  readonly monthlyPayment: Dollars;
  /**
   * Current estimated property value. Used for the depreciation estimate
   * when purchaseInfo is absent.
   */
  readonly propertyValue: Dollars;
  /**
   * Optional purchase records. When present, depreciation is exact and
   * accumulatedDepreciation is populated; when absent, depreciation is
   * estimated from propertyValue and accumulatedDepreciation is null.
   */
  readonly purchaseInfo?: InvestmentTaxPurchaseInfo;
  /**
   * Marginal tax rate as a decimal. Optional: when absent,
   * estimatedTaxShield is null.
   */
  readonly marginalTaxRate?: number;
}

export interface InvestmentTaxResult {
  /** Mandatory §5.6 disclaimer. Always present. */
  readonly disclaimer: string;
  /** Exact §2.5 annual interest over the next 12 months. */
  readonly annualInterest: Dollars;
  /** Straight-line annual depreciation (structure value / 27.5). */
  readonly annualDepreciation: Dollars;
  /**
   * Accumulated depreciation to date. Null when purchaseInfo was not
   * provided — it cannot be estimated without a purchase date.
   */
  readonly accumulatedDepreciation: Dollars | null;
  /**
   * Provenance of the depreciation figures: 'purchase_records' when
   * computed from purchaseInfo, 'estimated_from_value' when estimated
   * from the current property value.
   */
  readonly depreciationSource: 'purchase_records' | 'estimated_from_value';
  /** annualInterest + annualDepreciation. */
  readonly combinedAnnualDeduction: Dollars;
  /**
   * combinedAnnualDeduction * marginalTaxRate. Null when marginalTaxRate
   * was not provided.
   */
  readonly estimatedTaxShield: Dollars | null;
  /** Depreciation recapture display note (DEPRECIATION_RECAPTURE_NOTE). */
  readonly recaptureNote: string;
}

/**
 * §5.6 investment / multi_family tax optimization.
 *
 *   annual_interest            = §2.5 exact amortization sum
 *   annual_depreciation        = structure_value / 27.5
 *   combined_annual_deduction  = annual_interest + annual_depreciation
 *   tax_shield                 = combined_annual_deduction × marginal_tax_rate
 *
 * structure_value is purchasePrice × 0.80 when purchaseInfo is provided
 * (exact, via computeDepreciation), or propertyValue × 0.80 when it is
 * not (estimated). accumulatedDepreciation is reported only on the exact
 * path; on the estimated path it is null per §5.6.
 *
 * Informational only. Throws on a negative mortgageBalance, a
 * non-positive propertyValue, or a marginalTaxRate outside [0, 1] when
 * provided. Throws via computeDepreciation on malformed purchaseInfo
 * dates or a non-positive purchasePrice.
 */
export function computeInvestmentTax(
  ctx: InvestmentTaxContext,
): InvestmentTaxResult {
  assertValidLoanFacts(
    'computeInvestmentTax',
    ctx.mortgageBalance,
    ctx.marginalTaxRate,
  );
  if (ctx.propertyValue <= 0) {
    throw new Error('computeInvestmentTax: propertyValue must be positive');
  }
  const ai = annualInterest(
    ctx.mortgageBalance,
    ctx.monthlyRate,
    ctx.monthlyPayment,
  );

  let annualDepreciation: Dollars;
  let accumulatedDepreciation: Dollars | null;
  let depreciationSource: 'purchase_records' | 'estimated_from_value';
  if (ctx.purchaseInfo !== undefined) {
    const dep = computeDepreciation({
      purchasePrice: ctx.purchaseInfo.purchasePrice,
      purchaseDate: ctx.purchaseInfo.purchaseDate,
      asOfDate: ctx.purchaseInfo.asOfDate,
    });
    annualDepreciation = dep.annualDepreciation;
    accumulatedDepreciation = dep.accumulatedDepreciation;
    depreciationSource = 'purchase_records';
  } else {
    annualDepreciation =
      (ctx.propertyValue * STRUCTURE_VALUE_RATIO) / DEPRECIATION_LIFE_YEARS;
    accumulatedDepreciation = null;
    depreciationSource = 'estimated_from_value';
  }

  const combinedAnnualDeduction = ai + annualDepreciation;
  const estimatedTaxShield =
    ctx.marginalTaxRate !== undefined
      ? combinedAnnualDeduction * ctx.marginalTaxRate
      : null;
  return {
    disclaimer: TAX_DISCLAIMER,
    annualInterest: ai,
    annualDepreciation,
    accumulatedDepreciation,
    depreciationSource,
    combinedAnnualDeduction,
    estimatedTaxShield,
    recaptureNote: DEPRECIATION_RECAPTURE_NOTE,
  };
}
