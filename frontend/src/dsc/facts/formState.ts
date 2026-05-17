// Raw form state for the DSC property-entry form.
//
// Every field is a string — the unparsed shape exactly as the React inputs
// hold it. parse.ts turns this into a PropertyFacts (or a list of field
// errors). Keeping the form state stringly-typed and separate from the
// domain type is the "parse, don't validate" boundary.

import type { MortgageType, PropertyType } from './types';

export type FormState = {
  nickname: string;
  propertyValue: string;
  mortgageBalance: string;
  monthlyPayment: string;
  originalTermMonths: string;
  loanStartDate: string; // YYYY-MM-DD
  interestRate: string; // entered as percent: "6.75"
  mortgageType: '' | MortgageType;
  propertyType: '' | PropertyType;
  taxesInsuranceMonthly: string;
  monthlyGrossRent: string;
  operatingExpenseRate: string; // entered as percent: "40"
  purchasePrice: string;
  purchaseDate: string; // YYYY-MM-DD
};

export const INITIAL_FORM_STATE: FormState = {
  nickname: '',
  propertyValue: '',
  mortgageBalance: '',
  monthlyPayment: '',
  originalTermMonths: '',
  loanStartDate: '',
  interestRate: '',
  mortgageType: '',
  propertyType: '',
  taxesInsuranceMonthly: '',
  monthlyGrossRent: '',
  operatingExpenseRate: '',
  purchasePrice: '',
  purchaseDate: '',
};
