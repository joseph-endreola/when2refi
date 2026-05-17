// Totality property test for interpretTaxOptimization. There is no rate
// solver here (MATH.md §5.6 is informational); the test pins that the
// disclaimer is always TAX_DISCLAIMER and the discriminant is preserved.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type {
  InvestmentTaxResult,
  PrimaryResidenceTaxResult,
} from '@when2refi/math';
import { TAX_DISCLAIMER } from '@when2refi/math';
import {
  interpretTaxOptimization,
  type TaxOptimizationInput,
} from '../interpretTaxOptimization';
import { dollarArb } from './arbitraries';

const nullableDollar = fc.oneof(fc.constant(null), dollarArb);

const primaryResultArb: fc.Arbitrary<PrimaryResidenceTaxResult> = fc.record({
  disclaimer: fc.string(),
  annualInterest: dollarArb,
  deductibleBalanceCap: fc.constant(750_000),
  fullyDeductible: fc.boolean(),
  deductibleInterest: dollarArb,
  estimatedTaxBenefit: nullableDollar,
});

const investmentResultArb: fc.Arbitrary<InvestmentTaxResult> = fc.record({
  disclaimer: fc.string(),
  annualInterest: dollarArb,
  annualDepreciation: dollarArb,
  accumulatedDepreciation: nullableDollar,
  depreciationSource: fc.constantFrom(
    'purchase_records',
    'estimated_from_value',
  ),
  combinedAnnualDeduction: dollarArb,
  estimatedTaxShield: nullableDollar,
  recaptureNote: fc.string(),
});

const inputArb: fc.Arbitrary<TaxOptimizationInput> = fc.oneof(
  primaryResultArb.map((result) => ({ kind: 'primary' as const, result })),
  investmentResultArb.map((result) => ({
    kind: 'investment' as const,
    result,
  })),
);

describe('interpretTaxOptimization', () => {
  it('is total: always returns a display with the mandatory disclaimer', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const display = interpretTaxOptimization(input);
        expect(display.kind).toBe(input.kind);
        expect(display.disclaimer).toBe(TAX_DISCLAIMER);
      }),
    );
  });
});
