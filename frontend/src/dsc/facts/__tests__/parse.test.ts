// Tests for facts/parse.ts.
//
// Property test: round-trip identity within parser scope. parsePropertyFacts
// snaps every numeric field to the storage grid (whole cents, whole basis
// points), so a parsed value re-formatted to strings and parsed again must
// yield an identical PropertyFacts.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parsePropertyFacts } from '../parse';
import { INITIAL_FORM_STATE } from '../formState';
import type { FormState } from '../formState';
import type { PropertyFacts } from '../types';

// Fixed reference date passed to parsePropertyFacts — keeps the parser pure.
// All generated dates fall well before it.
const TODAY = new Date('2026-05-17T00:00:00.000Z');

// ---------- Generators ----------

const toISO = (d: Date): string => d.toISOString().slice(0, 10);

/** Cent-aligned positive dollar amount (so parse-snapping is a no-op). */
const moneyArb = fc.integer({ min: 1, max: 100_000_000 }).map((c) => c / 100);
/** Interest rate as integer basis points, 0.01%-19.99%. */
const rateBpsArb = fc.integer({ min: 1, max: 1999 });
/** Operating expense rate as integer basis points, 0%-100%. */
const oerBpsArb = fc.integer({ min: 0, max: 10_000 });
const termArb = fc.integer({ min: 1, max: 600 });
const pastDateArb = fc
  .date({
    min: new Date('1990-01-01T00:00:00.000Z'),
    max: new Date('2020-12-31T00:00:00.000Z'),
    noInvalidDate: true,
  })
  .map(
    (d) =>
      new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())),
  );

const mortgageTypeArb = fc.constantFrom(
  'FHA',
  'VA',
  'Conventional',
  'DSCR',
  'Other',
) as fc.Arbitrary<FormState['mortgageType']>;
const propertyTypeArb = fc.constantFrom(
  'primary',
  'investment',
  'multi_family',
) as fc.Arbitrary<FormState['propertyType']>;

const formStateArb: fc.Arbitrary<FormState> = fc.record({
  nickname: fc.constantFrom('', 'Home', '123 Main St', 'Rental A'),
  propertyValue: moneyArb.map(String),
  mortgageBalance: moneyArb.map(String),
  monthlyPayment: moneyArb.map(String),
  originalTermMonths: termArb.map(String),
  loanStartDate: pastDateArb.map(toISO),
  interestRate: rateBpsArb.map((bps) => String(bps / 100)),
  mortgageType: mortgageTypeArb,
  propertyType: propertyTypeArb,
  taxesInsuranceMonthly: fc.oneof(fc.constant(''), moneyArb.map(String)),
  monthlyGrossRent: fc.oneof(fc.constant(''), moneyArb.map(String)),
  operatingExpenseRate: fc.oneof(
    fc.constant(''),
    oerBpsArb.map((bps) => String(bps / 100)),
  ),
  purchasePrice: fc.oneof(fc.constant(''), moneyArb.map(String)),
  purchaseDate: fc.oneof(fc.constant(''), pastDateArb.map(toISO)),
});

/** Inverse of parsePropertyFacts, used to close the round-trip. */
function factsToFormState(facts: PropertyFacts): FormState {
  const income =
    facts.propertyType === 'primary'
      ? {}
      : {
          monthlyGrossRent:
            facts.monthlyGrossRent !== undefined
              ? String(facts.monthlyGrossRent)
              : '',
          operatingExpenseRate:
            facts.operatingExpenseRate !== undefined
              ? String(facts.operatingExpenseRate * 100)
              : '',
          purchasePrice:
            facts.purchasePrice !== undefined
              ? String(facts.purchasePrice)
              : '',
          purchaseDate:
            facts.purchaseDate !== undefined ? toISO(facts.purchaseDate) : '',
        };
  return {
    nickname: facts.nickname ?? '',
    propertyValue: String(facts.propertyValue),
    mortgageBalance: String(facts.mortgageBalance),
    monthlyPayment: String(facts.monthlyPayment),
    originalTermMonths: String(facts.originalTermMonths),
    loanStartDate: toISO(facts.loanStartDate),
    interestRate: String(facts.interestRate * 100),
    mortgageType: facts.mortgageType,
    propertyType: facts.propertyType,
    taxesInsuranceMonthly:
      facts.taxesInsuranceMonthly !== undefined
        ? String(facts.taxesInsuranceMonthly)
        : '',
    monthlyGrossRent: '',
    operatingExpenseRate: '',
    purchasePrice: '',
    purchaseDate: '',
    ...income,
  };
}

// ---------- Property test ----------

describe('parsePropertyFacts round-trip', () => {
  it('parse, reformat, parse again yields the first parse value', () => {
    fc.assert(
      fc.property(formStateArb, (form) => {
        const first = parsePropertyFacts(form, TODAY);
        expect(first.ok).toBe(true);
        if (!first.ok) return;

        const second = parsePropertyFacts(
          factsToFormState(first.value),
          TODAY,
        );
        expect(second.ok).toBe(true);
        if (!second.ok) return;

        expect(second.value).toEqual(first.value);
      }),
    );
  });
});

// ---------- Validation examples ----------

describe('parsePropertyFacts validation', () => {
  const validForm: FormState = {
    ...INITIAL_FORM_STATE,
    propertyValue: '450000',
    mortgageBalance: '325000',
    monthlyPayment: '2100.55',
    originalTermMonths: '360',
    loanStartDate: '2020-01-15',
    interestRate: '6.75',
    mortgageType: 'Conventional',
    propertyType: 'primary',
  };

  it('rejects an empty form with errors for every required core field', () => {
    const result = parsePropertyFacts(INITIAL_FORM_STATE, TODAY);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const fields = new Set(result.errors.map((e) => e.field));
    for (const f of [
      'propertyValue',
      'mortgageBalance',
      'monthlyPayment',
      'originalTermMonths',
      'loanStartDate',
      'interestRate',
      'mortgageType',
      'propertyType',
    ] as const) {
      expect(fields.has(f)).toBe(true);
    }
  });

  it('accepts a valid primary-residence form', () => {
    const result = parsePropertyFacts(validForm, TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.propertyType).toBe('primary');
    expect(result.value.interestRate).toBeCloseTo(0.0675, 6);
  });

  it('rejects a future loan start date', () => {
    const result = parsePropertyFacts(
      { ...validForm, loanStartDate: '2999-01-01' },
      TODAY,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === 'loanStartDate')).toBe(true);
  });

  it('rejects an interest rate at or above 20%', () => {
    const result = parsePropertyFacts(
      { ...validForm, interestRate: '25' },
      TODAY,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === 'interestRate')).toBe(true);
  });

  it('rejects a non-integer term', () => {
    const result = parsePropertyFacts(
      { ...validForm, originalTermMonths: '360.5' },
      TODAY,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field === 'originalTermMonths')).toBe(
      true,
    );
  });

  it('ignores investment-only fields on a primary residence', () => {
    const result = parsePropertyFacts(
      { ...validForm, monthlyGrossRent: '3000', purchasePrice: '400000' },
      TODAY,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('monthlyGrossRent' in result.value).toBe(false);
    expect('purchasePrice' in result.value).toBe(false);
  });

  it('omits empty income fields rather than defaulting them to zero', () => {
    const result = parsePropertyFacts(
      {
        ...validForm,
        propertyType: 'investment',
        monthlyGrossRent: '',
        operatingExpenseRate: '',
      },
      TODAY,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('monthlyGrossRent' in result.value).toBe(false);
    expect('operatingExpenseRate' in result.value).toBe(false);
  });
});
