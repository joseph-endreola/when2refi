// Storage boundary: PropertyFacts <-> D1 `properties` row.
//
// PropertyRow mirrors the `properties` table (backend/migrations/
// 0001_initial_schema.sql) for the columns the application writes. The
// DB-managed `created_at` / `updated_at` columns (SQL DEFAULT datetime('now'))
// are intentionally absent — the app never supplies them, and a pure,
// clock-free conversion function cannot fabricate them.
//
// Every cents / bps conversion goes through the math package's §1 boundary
// functions. No inline `/ 100` or `/ 10000` anywhere in this file.

import type {
  MortgageType,
  PropertyType,
  PropertyFacts,
} from './types';
import {
  annualRateToBps,
  bps,
  bpsToAnnualRate,
  cents,
  centsToDollars,
  dollarsToCents,
} from '@when2refi/math';

/**
 * The `properties` row as the application reads and writes it. All `*_cents`
 * and `*_bps` columns are raw integers; dates are ISO `YYYY-MM-DD` strings.
 * Investment / multi_family columns are null on a primary residence.
 */
export type PropertyRow = {
  id: string;
  user_id: string;
  nickname: string | null;
  property_value_cents: number;
  mortgage_balance_cents: number;
  monthly_payment_cents: number;
  original_term_months: number;
  loan_start_date: string; // YYYY-MM-DD
  interest_rate_bps: number;
  mortgage_type: MortgageType;
  property_type: PropertyType;
  taxes_insurance_monthly_cents: number | null;
  monthly_gross_rent_cents: number | null;
  operating_expense_rate_bps: number | null;
  purchase_price_cents: number | null;
  purchase_date: string | null; // YYYY-MM-DD
  goal_notification_logic: 'ANY' | 'ALL';
  monitoring_enabled: number; // 0 | 1
  deleted_at: string | null;
};

// ---------- Date <-> ISO ----------

const toISODate = (d: Date): string => d.toISOString().slice(0, 10);
const fromISODate = (iso: string): Date =>
  new Date(`${iso}T00:00:00.000Z`);

// ---------- Facts -> Row ----------

/**
 * Convert PropertyFacts into a persistable `properties` row.
 *
 * Non-facts columns take their insert-time defaults: `goal_notification_logic`
 * 'ANY', `monitoring_enabled` 0, `deleted_at` null. These are not derivable
 * from PropertyFacts and the caller is expected to override them when
 * persisting an edit rather than a fresh insert.
 */
export function propertyFactsToRow(
  facts: PropertyFacts,
  userId: string,
  id: string,
): PropertyRow {
  const base = {
    id,
    user_id: userId,
    nickname: facts.nickname ?? null,
    property_value_cents: dollarsToCents(facts.propertyValue) as number,
    mortgage_balance_cents: dollarsToCents(facts.mortgageBalance) as number,
    monthly_payment_cents: dollarsToCents(facts.monthlyPayment) as number,
    original_term_months: facts.originalTermMonths,
    loan_start_date: toISODate(facts.loanStartDate),
    interest_rate_bps: annualRateToBps(facts.interestRate) as number,
    mortgage_type: facts.mortgageType,
    property_type: facts.propertyType,
    taxes_insurance_monthly_cents:
      facts.taxesInsuranceMonthly !== undefined
        ? (dollarsToCents(facts.taxesInsuranceMonthly) as number)
        : null,
    goal_notification_logic: 'ANY' as const,
    monitoring_enabled: 0,
    deleted_at: null,
  };

  if (facts.propertyType === 'primary') {
    return {
      ...base,
      monthly_gross_rent_cents: null,
      operating_expense_rate_bps: null,
      purchase_price_cents: null,
      purchase_date: null,
    };
  }

  return {
    ...base,
    monthly_gross_rent_cents:
      facts.monthlyGrossRent !== undefined
        ? (dollarsToCents(facts.monthlyGrossRent) as number)
        : null,
    // operating_expense_rate_bps is a ratio in basis points; the bps<->decimal
    // conversion is the same /10000 the rate helpers perform.
    operating_expense_rate_bps:
      facts.operatingExpenseRate !== undefined
        ? (annualRateToBps(facts.operatingExpenseRate) as number)
        : null,
    purchase_price_cents:
      facts.purchasePrice !== undefined
        ? (dollarsToCents(facts.purchasePrice) as number)
        : null,
    purchase_date:
      facts.purchaseDate !== undefined ? toISODate(facts.purchaseDate) : null,
  };
}

// ---------- Row -> Facts ----------

/**
 * Convert a D1 `properties` row back into PropertyFacts. Raw integers are
 * wrapped once with the math `cents` / `bps` smart constructors before
 * conversion. Optional columns become absent properties (not `undefined`
 * values) per the exactOptionalPropertyTypes convention.
 */
export function propertyRowToFacts(row: PropertyRow): PropertyFacts {
  const core = {
    ...(row.nickname !== null ? { nickname: row.nickname } : {}),
    propertyValue: centsToDollars(cents(row.property_value_cents)),
    mortgageBalance: centsToDollars(cents(row.mortgage_balance_cents)),
    monthlyPayment: centsToDollars(cents(row.monthly_payment_cents)),
    originalTermMonths: row.original_term_months,
    loanStartDate: fromISODate(row.loan_start_date),
    interestRate: bpsToAnnualRate(bps(row.interest_rate_bps)),
    mortgageType: row.mortgage_type,
    ...(row.taxes_insurance_monthly_cents !== null
      ? {
          taxesInsuranceMonthly: centsToDollars(
            cents(row.taxes_insurance_monthly_cents),
          ),
        }
      : {}),
  };

  if (row.property_type === 'primary') {
    return { ...core, propertyType: 'primary' };
  }

  const extras = {
    ...(row.monthly_gross_rent_cents !== null
      ? {
          monthlyGrossRent: centsToDollars(cents(row.monthly_gross_rent_cents)),
        }
      : {}),
    ...(row.operating_expense_rate_bps !== null
      ? {
          operatingExpenseRate: bpsToAnnualRate(
            bps(row.operating_expense_rate_bps),
          ),
        }
      : {}),
    ...(row.purchase_price_cents !== null
      ? { purchasePrice: centsToDollars(cents(row.purchase_price_cents)) }
      : {}),
    ...(row.purchase_date !== null
      ? { purchaseDate: fromISODate(row.purchase_date) }
      : {}),
  };

  return row.property_type === 'investment'
    ? { ...core, ...extras, propertyType: 'investment' }
    : { ...core, ...extras, propertyType: 'multi_family' };
}
