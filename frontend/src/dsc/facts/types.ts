// Domain types for the Decision Support Calculator.
//
// PropertyFacts is the parsed, validated representation of a property — the
// type that flows through the DSC interior. It is produced once at the form
// boundary (facts/parse.ts) and at the storage boundary (facts/storage.ts);
// no other layer re-validates it.
//
// The discriminated union on propertyType makes illegal states
// unrepresentable: investment-only fields cannot exist on a primary
// residence, and the income-producing variants share the same extras.

import type { Dollars, AnnualRate } from '@when2refi/math';

export type MortgageType = 'FHA' | 'VA' | 'Conventional' | 'DSCR' | 'Other';
export type PropertyType = 'primary' | 'investment' | 'multi_family';

type CoreFacts = {
  nickname?: string;
  propertyValue: Dollars;
  mortgageBalance: Dollars;
  monthlyPayment: Dollars; // P&I only
  originalTermMonths: number;
  loanStartDate: Date;
  interestRate: AnnualRate; // decimal, e.g. 0.0675
  mortgageType: MortgageType;
  taxesInsuranceMonthly?: Dollars;
};

type IncomeProducingExtras = {
  monthlyGrossRent?: Dollars;
  operatingExpenseRate?: number; // decimal, e.g. 0.40
  purchasePrice?: Dollars;
  purchaseDate?: Date;
};

export type PrimaryResidenceFacts = CoreFacts & { propertyType: 'primary' };
export type InvestmentFacts = CoreFacts &
  IncomeProducingExtras & { propertyType: 'investment' };
export type MultiFamilyFacts = CoreFacts &
  IncomeProducingExtras & { propertyType: 'multi_family' };

export type PropertyFacts =
  | PrimaryResidenceFacts
  | InvestmentFacts
  | MultiFamilyFacts;
export type IncomeProducingFacts = InvestmentFacts | MultiFamilyFacts;
