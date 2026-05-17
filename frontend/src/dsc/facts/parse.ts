// Form boundary: FormState (all strings) -> PropertyFacts (domain type).
//
// parsePropertyFacts is a single total function. It never throws: every
// rejected input becomes a ParseError in the returned list, and all field
// errors are collected in one pass so the UI can show them together.
//
// "Parse, don't validate": the result carries a PropertyFacts that the rest
// of the DSC never re-checks. Numeric fields are snapped to the storage
// grid here — money to whole cents, rates to whole basis points — using the
// math package's §1 boundary functions, so a parsed value already matches
// what D1 can store and round-trips through facts/storage.ts exactly.

import type {
  MortgageType,
  PropertyType,
  PropertyFacts,
  PrimaryResidenceFacts,
  InvestmentFacts,
  MultiFamilyFacts,
} from './types';
import type { FormState } from './formState';
import type { AnnualRate, Dollars } from '@when2refi/math';
import {
  annualRateToBps,
  bpsToAnnualRate,
  centsToDollars,
  dollarsToCents,
} from '@when2refi/math';

// ---------- Public result types ----------

export type ParseError = { field: keyof FormState; message: string };
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ParseError[] };

// ---------- Internal per-field result ----------

type Field<T> =
  | { ok: true; value: T }
  | { ok: false; error: ParseError };

const fieldOk = <T>(value: T): Field<T> => ({ ok: true, value });
const fieldErr = (field: keyof FormState, message: string): Field<never> => ({
  ok: false,
  error: { field, message },
});

// ---------- Storage-grid snapping (math §1 boundary functions only) ----------

/** Snap a dollar amount to the whole-cent grid D1 stores. */
const snapMoney = (d: number): Dollars => centsToDollars(dollarsToCents(d));

/** Snap a decimal annual rate to the whole-basis-point grid D1 stores. */
const snapRate = (r: number): AnnualRate => bpsToAnnualRate(annualRateToBps(r));

// ---------- Field parsers ----------

function parseNickname(raw: string): Field<string | undefined> {
  const trimmed = raw.trim();
  return fieldOk(trimmed === '' ? undefined : trimmed);
}

function parseRequiredMoney(
  field: keyof FormState,
  raw: string,
): Field<Dollars> {
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (cleaned === '') return fieldErr(field, 'Required.');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return fieldErr(field, 'Must be a number.');
  const snapped = snapMoney(n);
  if (snapped <= 0) return fieldErr(field, 'Must be greater than zero.');
  return fieldOk(snapped);
}

function parseOptionalMoney(
  field: keyof FormState,
  raw: string,
  allowZero: boolean,
): Field<Dollars | undefined> {
  const cleaned = raw.replace(/[$,\s]/g, '');
  if (cleaned === '') return fieldOk(undefined);
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return fieldErr(field, 'Must be a number.');
  const snapped = snapMoney(n);
  if (allowZero ? snapped < 0 : snapped <= 0) {
    return fieldErr(
      field,
      allowZero ? 'Must not be negative.' : 'Must be greater than zero.',
    );
  }
  return fieldOk(snapped);
}

function parseTermMonths(raw: string): Field<number> {
  const cleaned = raw.trim();
  if (cleaned === '') return fieldErr('originalTermMonths', 'Required.');
  const n = Number(cleaned);
  if (!Number.isInteger(n) || n <= 0) {
    return fieldErr(
      'originalTermMonths',
      'Must be a positive whole number of months.',
    );
  }
  return fieldOk(n);
}

function parseInterestRate(raw: string): Field<AnnualRate> {
  const cleaned = raw.replace(/[%\s]/g, '');
  if (cleaned === '') return fieldErr('interestRate', 'Required.');
  const pct = Number(cleaned);
  if (!Number.isFinite(pct)) return fieldErr('interestRate', 'Must be a number.');
  const snapped = snapRate(pct / 100);
  if (!(snapped > 0 && snapped < 0.2)) {
    return fieldErr('interestRate', 'Must be between 0% and 20%.');
  }
  return fieldOk(snapped);
}

function parseOperatingExpenseRate(raw: string): Field<number | undefined> {
  const cleaned = raw.replace(/[%\s]/g, '');
  if (cleaned === '') return fieldOk(undefined);
  const pct = Number(cleaned);
  if (!Number.isFinite(pct)) {
    return fieldErr('operatingExpenseRate', 'Must be a number.');
  }
  const snapped = snapRate(pct / 100);
  if (!(snapped >= 0 && snapped <= 1)) {
    return fieldErr('operatingExpenseRate', 'Must be between 0% and 100%.');
  }
  return fieldOk(snapped);
}

function parseMortgageType(raw: '' | MortgageType): Field<MortgageType> {
  if (raw === '') return fieldErr('mortgageType', 'Required.');
  return fieldOk(raw);
}

function parsePropertyType(raw: '' | PropertyType): Field<PropertyType> {
  if (raw === '') return fieldErr('propertyType', 'Required.');
  return fieldOk(raw);
}

/** Parse a YYYY-MM-DD string to a real UTC-midnight Date, or null. */
function parseISOToDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Reject overflow dates (e.g. 2024-02-31 rolling into March).
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function parseRequiredDate(
  field: keyof FormState,
  raw: string,
  todayISO: string,
): Field<Date> {
  const cleaned = raw.trim();
  if (cleaned === '') return fieldErr(field, 'Required.');
  const date = parseISOToDate(cleaned);
  if (date === null) {
    return fieldErr(field, 'Must be a valid date (YYYY-MM-DD).');
  }
  // YYYY-MM-DD strings sort lexically in chronological order.
  if (cleaned > todayISO) {
    return fieldErr(field, 'Must not be in the future.');
  }
  return fieldOk(date);
}

function parseOptionalDate(
  field: keyof FormState,
  raw: string,
  todayISO: string,
): Field<Date | undefined> {
  if (raw.trim() === '') return fieldOk(undefined);
  return parseRequiredDate(field, raw, todayISO);
}

// ---------- Entry point ----------

/**
 * Parse a FormState into a PropertyFacts.
 *
 * Total: returns `{ ok: false, errors }` with every field error collected
 * rather than throwing or stopping at the first failure.
 *
 * Required: all core fields. Investment / multi_family extras are always
 * optional even on those property types; an empty extra is omitted, not
 * defaulted to zero (the math layer applies its own defaults). Extras on a
 * primary residence are ignored entirely — never validated, never included.
 *
 * `today` is passed in rather than read from the system clock (type-signature
 * law #13: isolate non-determinism). The only clock-dependent rule is "loan
 * start / purchase date not in the future"; the caller supplies the reference
 * date so the function stays pure and reproducible.
 */
export function parsePropertyFacts(
  form: FormState,
  today: Date,
): ParseResult<PropertyFacts> {
  const todayISO = today.toISOString().slice(0, 10);

  const nickname = parseNickname(form.nickname);
  const propertyValue = parseRequiredMoney('propertyValue', form.propertyValue);
  const mortgageBalance = parseRequiredMoney(
    'mortgageBalance',
    form.mortgageBalance,
  );
  const monthlyPayment = parseRequiredMoney(
    'monthlyPayment',
    form.monthlyPayment,
  );
  const originalTermMonths = parseTermMonths(form.originalTermMonths);
  const loanStartDate = parseRequiredDate(
    'loanStartDate',
    form.loanStartDate,
    todayISO,
  );
  const interestRate = parseInterestRate(form.interestRate);
  const mortgageType = parseMortgageType(form.mortgageType);
  const propertyType = parsePropertyType(form.propertyType);
  const taxesInsuranceMonthly = parseOptionalMoney(
    'taxesInsuranceMonthly',
    form.taxesInsuranceMonthly,
    true,
  );

  // Income-producing extras are parsed only when the property type resolves
  // to investment or multi_family. On a primary residence they are ignored.
  const isIncomeProducing =
    propertyType.ok &&
    (propertyType.value === 'investment' ||
      propertyType.value === 'multi_family');

  const monthlyGrossRent: Field<Dollars | undefined> = isIncomeProducing
    ? parseOptionalMoney('monthlyGrossRent', form.monthlyGrossRent, false)
    : fieldOk(undefined);
  const operatingExpenseRate: Field<number | undefined> = isIncomeProducing
    ? parseOperatingExpenseRate(form.operatingExpenseRate)
    : fieldOk(undefined);
  const purchasePrice: Field<Dollars | undefined> = isIncomeProducing
    ? parseOptionalMoney('purchasePrice', form.purchasePrice, false)
    : fieldOk(undefined);
  const purchaseDate: Field<Date | undefined> = isIncomeProducing
    ? parseOptionalDate('purchaseDate', form.purchaseDate, todayISO)
    : fieldOk(undefined);

  if (
    nickname.ok &&
    propertyValue.ok &&
    mortgageBalance.ok &&
    monthlyPayment.ok &&
    originalTermMonths.ok &&
    loanStartDate.ok &&
    interestRate.ok &&
    mortgageType.ok &&
    propertyType.ok &&
    taxesInsuranceMonthly.ok &&
    monthlyGrossRent.ok &&
    operatingExpenseRate.ok &&
    purchasePrice.ok &&
    purchaseDate.ok
  ) {
    const core = {
      ...(nickname.value !== undefined ? { nickname: nickname.value } : {}),
      propertyValue: propertyValue.value,
      mortgageBalance: mortgageBalance.value,
      monthlyPayment: monthlyPayment.value,
      originalTermMonths: originalTermMonths.value,
      loanStartDate: loanStartDate.value,
      interestRate: interestRate.value,
      mortgageType: mortgageType.value,
      ...(taxesInsuranceMonthly.value !== undefined
        ? { taxesInsuranceMonthly: taxesInsuranceMonthly.value }
        : {}),
    };

    if (propertyType.value === 'primary') {
      const facts: PrimaryResidenceFacts = {
        ...core,
        propertyType: 'primary',
      };
      return { ok: true, value: facts };
    }

    const extras = {
      ...(monthlyGrossRent.value !== undefined
        ? { monthlyGrossRent: monthlyGrossRent.value }
        : {}),
      ...(operatingExpenseRate.value !== undefined
        ? { operatingExpenseRate: operatingExpenseRate.value }
        : {}),
      ...(purchasePrice.value !== undefined
        ? { purchasePrice: purchasePrice.value }
        : {}),
      ...(purchaseDate.value !== undefined
        ? { purchaseDate: purchaseDate.value }
        : {}),
    };

    const facts: InvestmentFacts | MultiFamilyFacts =
      propertyType.value === 'investment'
        ? { ...core, ...extras, propertyType: 'investment' }
        : { ...core, ...extras, propertyType: 'multi_family' };
    return { ok: true, value: facts };
  }

  const errors: ParseError[] = [];
  for (const field of [
    nickname,
    propertyValue,
    mortgageBalance,
    monthlyPayment,
    originalTermMonths,
    loanStartDate,
    interestRate,
    mortgageType,
    propertyType,
    taxesInsuranceMonthly,
    monthlyGrossRent,
    operatingExpenseRate,
    purchasePrice,
    purchaseDate,
  ]) {
    if (!field.ok) errors.push(field.error);
  }
  return { ok: false, errors };
}
