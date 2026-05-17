// §5.6 tax_optimization: math tax result -> TaxOptimizationDisplay.
//
// There is no rate solver here (MATH.md §5.6 is informational only), so the
// interpreter shapes the math output directly into a display and does not
// produce a GoalOutcome. TAX_DISCLAIMER is attached unconditionally — the
// display type makes `disclaimer` required so it can never be dropped.
//
// The two math tax results have no shared discriminant, so the caller tags
// the input. Exhaustive switch, no default clause.

import type {
  PrimaryResidenceTaxResult,
  InvestmentTaxResult,
} from '@when2refi/math';
import { TAX_DISCLAIMER } from '@when2refi/math';
import type { TaxOptimizationDisplay } from './displays';

export type TaxOptimizationInput =
  | { kind: 'primary'; result: PrimaryResidenceTaxResult }
  | { kind: 'investment'; result: InvestmentTaxResult };

export function interpretTaxOptimization(
  input: TaxOptimizationInput,
): TaxOptimizationDisplay {
  switch (input.kind) {
    case 'primary': {
      const r = input.result;
      return {
        kind: 'primary',
        disclaimer: TAX_DISCLAIMER,
        annualInterest: r.annualInterest,
        deductibleBalanceCap: r.deductibleBalanceCap,
        fullyDeductible: r.fullyDeductible,
        deductibleInterest: r.deductibleInterest,
        estimatedTaxBenefit: r.estimatedTaxBenefit,
      };
    }
    case 'investment': {
      const r = input.result;
      return {
        kind: 'investment',
        disclaimer: TAX_DISCLAIMER,
        annualInterest: r.annualInterest,
        annualDepreciation: r.annualDepreciation,
        accumulatedDepreciation: r.accumulatedDepreciation,
        depreciationSource: r.depreciationSource,
        combinedAnnualDeduction: r.combinedAnnualDeduction,
        estimatedTaxShield: r.estimatedTaxShield,
        recaptureNote: r.recaptureNote,
      };
    }
  }
}
