// Tests for facts/storage.ts.
//
// Property test: full round-trip PropertyFacts -> PropertyRow -> PropertyFacts.
//
// Tolerance. The storage grid is whole cents and whole basis points, so a
// round trip can drift by at most half a unit:
//   money: dollarsToCents rounds to the nearest cent  -> +/- 0.005 dollars
//   rates: annualRateToBps rounds to the nearest bp   -> +/- 0.00005
// Dates, term months, and the enum/string fields are exact.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { propertyFactsToRow, propertyRowToFacts } from '../storage';
import type { MortgageType, PropertyFacts } from '../types';

const MONEY_TOLERANCE = 0.005; // half a cent, in dollars
const RATE_TOLERANCE = 0.00005; // half a basis point, in decimal

// ---------- Generators ----------

const moneyArb = fc.double({
  min: 1,
  max: 1e7,
  noNaN: true,
  noDefaultInfinity: true,
});
const rateArb = fc.double({
  min: 0.0001,
  max: 0.1999,
  noNaN: true,
  noDefaultInfinity: true,
});
const oerArb = fc.double({
  min: 0,
  max: 1,
  noNaN: true,
  noDefaultInfinity: true,
});
const termArb = fc.integer({ min: 1, max: 600 });
const dateArb = fc
  .date({
    min: new Date('1990-01-01T00:00:00.000Z'),
    max: new Date('2025-12-31T00:00:00.000Z'),
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
) as fc.Arbitrary<MortgageType>;

const coreArb = fc.record(
  {
    nickname: fc.string(),
    propertyValue: moneyArb,
    mortgageBalance: moneyArb,
    monthlyPayment: moneyArb,
    originalTermMonths: termArb,
    loanStartDate: dateArb,
    interestRate: rateArb,
    mortgageType: mortgageTypeArb,
    taxesInsuranceMonthly: moneyArb,
  },
  {
    requiredKeys: [
      'propertyValue',
      'mortgageBalance',
      'monthlyPayment',
      'originalTermMonths',
      'loanStartDate',
      'interestRate',
      'mortgageType',
    ],
  },
);

const extrasArb = fc.record(
  {
    monthlyGrossRent: moneyArb,
    operatingExpenseRate: oerArb,
    purchasePrice: moneyArb,
    purchaseDate: dateArb,
  },
  { requiredKeys: [] },
);

const factsArb: fc.Arbitrary<PropertyFacts> = fc.oneof(
  coreArb.map((core) => ({ ...core, propertyType: 'primary' as const })),
  fc
    .tuple(coreArb, extrasArb)
    .map(([core, extras]) => ({
      ...core,
      ...extras,
      propertyType: 'investment' as const,
    })),
  fc
    .tuple(coreArb, extrasArb)
    .map(([core, extras]) => ({
      ...core,
      ...extras,
      propertyType: 'multi_family' as const,
    })),
);

// ---------- Comparison helpers ----------

function expectMoneyClose(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(MONEY_TOLERANCE);
}

function expectOptionalMoney(
  back: Record<string, unknown>,
  facts: Record<string, unknown>,
  key: string,
): void {
  expect(key in back).toBe(key in facts);
  if (key in facts) {
    expectMoneyClose(back[key] as number, facts[key] as number);
  }
}

// ---------- Property test ----------

describe('propertyFactsToRow / propertyRowToFacts round-trip', () => {
  it('preserves PropertyFacts within cent / basis-point tolerance', () => {
    fc.assert(
      fc.property(factsArb, (facts) => {
        const row = propertyFactsToRow(facts, 'user_test', 'id_test');
        const back = propertyRowToFacts(row);

        // Exact fields.
        expect(back.propertyType).toBe(facts.propertyType);
        expect(back.mortgageType).toBe(facts.mortgageType);
        expect(back.originalTermMonths).toBe(facts.originalTermMonths);
        expect(back.loanStartDate.getTime()).toBe(facts.loanStartDate.getTime());

        // Money fields, within half a cent.
        expectMoneyClose(back.propertyValue, facts.propertyValue);
        expectMoneyClose(back.mortgageBalance, facts.mortgageBalance);
        expectMoneyClose(back.monthlyPayment, facts.monthlyPayment);

        // Interest rate, within half a basis point.
        expect(
          Math.abs(back.interestRate - facts.interestRate),
        ).toBeLessThanOrEqual(RATE_TOLERANCE);

        // Optional core fields: presence preserved.
        expect('nickname' in back).toBe('nickname' in facts);
        if ('nickname' in facts) {
          expect(back.nickname).toBe(facts.nickname);
        }
        expectOptionalMoney(
          back as Record<string, unknown>,
          facts as Record<string, unknown>,
          'taxesInsuranceMonthly',
        );

        // Income-producing extras.
        if (facts.propertyType !== 'primary' && back.propertyType !== 'primary') {
          expectOptionalMoney(
            back as Record<string, unknown>,
            facts as Record<string, unknown>,
            'monthlyGrossRent',
          );
          expectOptionalMoney(
            back as Record<string, unknown>,
            facts as Record<string, unknown>,
            'purchasePrice',
          );
          expect('operatingExpenseRate' in back).toBe(
            'operatingExpenseRate' in facts,
          );
          if (
            facts.operatingExpenseRate !== undefined &&
            back.operatingExpenseRate !== undefined
          ) {
            expect(
              Math.abs(back.operatingExpenseRate - facts.operatingExpenseRate),
            ).toBeLessThanOrEqual(RATE_TOLERANCE);
          }
          expect('purchaseDate' in back).toBe('purchaseDate' in facts);
          if (
            facts.purchaseDate !== undefined &&
            back.purchaseDate !== undefined
          ) {
            expect(back.purchaseDate.getTime()).toBe(
              facts.purchaseDate.getTime(),
            );
          }
        }
      }),
    );
  });
});
