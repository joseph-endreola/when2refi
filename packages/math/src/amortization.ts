// Pure functions for MATH.md §2 (Amortization Engine).
// Inputs and outputs are in working units: dollars (number), decimal rate
// (number), months (integer). Cents and basis-point conversions live at the
// storage boundary in `./units`.
//
// All functions are total over their stated domains. r_m = 0 is handled
// explicitly. Date math avoids Date objects to sidestep timezone drift.

import type { Dollars, MonthlyRate } from './units';
export type { Dollars, MonthlyRate };

/** Months, integer. */
export type Months = number;

/**
 * Result of remaining-term derivation. The 'matured' branch is a legitimate
 * domain state — the goal solver must handle it explicitly and must not run
 * on a matured loan.
 */
export type RemainingTerm =
  | { kind: 'active'; monthsRemaining: Months; monthsElapsed: Months }
  | { kind: 'matured'; monthsElapsed: Months };

// ---------- §2.1 Standard Monthly Payment ----------

/**
 * P&I monthly payment for a fully amortizing loan.
 *
 *   P(B, r_m, n) = B × r_m × (1 + r_m)^n / ((1 + r_m)^n - 1)
 *
 * Edge case: r_m = 0  →  P = B / n
 *
 * P&I only. Taxes and insurance are tracked separately and are never
 * included in amortization.
 */
export function monthlyPayment(
  balance: Dollars,
  monthlyRate: MonthlyRate,
  termMonths: Months,
): Dollars {
  if (termMonths <= 0) {
    throw new Error('monthlyPayment: termMonths must be positive');
  }
  if (monthlyRate === 0) {
    return balance / termMonths;
  }
  const growth = Math.pow(1 + monthlyRate, termMonths);
  return (balance * monthlyRate * growth) / (growth - 1);
}

// ---------- §2.2 Remaining Term ----------

/**
 * Integer calendar months between two YYYY-MM-DD date strings, floored.
 * Returns 0 if end is before start.
 *
 * Parses components directly to avoid Date object timezone semantics.
 */
export function monthsBetween(startISO: string, endISO: string): Months {
  const parseDate = (iso: string): [number, number, number] => {
    const parts = iso.split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (
      parts.length !== 3 ||
      !Number.isFinite(y) ||
      !Number.isFinite(m) ||
      !Number.isFinite(d)
    ) {
      throw new Error(`monthsBetween: invalid date input (${iso})`);
    }
    return [y, m, d];
  };
  const [sy, sm, sd] = parseDate(startISO);
  const [ey, em, ed] = parseDate(endISO);
  let months = (ey - sy) * 12 + (em - sm);
  if (ed < sd) months -= 1;
  return Math.max(0, months);
}

/**
 * Derive remaining term from loan start date, original term, and today.
 *
 *   months_elapsed = floor(months between loan_start_date and today)
 *   n_remaining    = original_term_months - months_elapsed
 *
 * Returns 'matured' when n_remaining <= 0 so callers must handle it.
 */
export function remainingTerm(
  loanStartDateISO: string,
  originalTermMonths: Months,
  todayISO: string,
): RemainingTerm {
  const monthsElapsed = monthsBetween(loanStartDateISO, todayISO);
  const monthsRemaining = originalTermMonths - monthsElapsed;
  if (monthsRemaining <= 0) {
    return { kind: 'matured', monthsElapsed };
  }
  return { kind: 'active', monthsRemaining, monthsElapsed };
}

// ---------- §2.3 Remaining Interest ----------

/**
 * Total interest remaining on a performing loan.
 *
 *   RI_current = P × n_remaining - B
 *
 * Always positive for a performing loan.
 */
export function remainingInterest(
  monthlyPaymentAmount: Dollars,
  monthsRemaining: Months,
  balance: Dollars,
): Dollars {
  return monthlyPaymentAmount * monthsRemaining - balance;
}

// ---------- §2.4 Balance at Month k ----------

/**
 * Outstanding balance after k scheduled payments.
 *
 *   B_k = B × (1 + r_m)^k - P × ((1 + r_m)^k - 1) / r_m
 *
 * Edge case: r_m = 0  →  B_k = B - P × k
 *
 * Clamps at 0. Past full amortization, balance is zero, not negative.
 */
export function balanceAtMonth(
  balance: Dollars,
  monthlyRate: MonthlyRate,
  monthlyPaymentAmount: Dollars,
  k: number,
): Dollars {
  if (k <= 0) return balance;
  if (monthlyRate === 0) {
    return Math.max(0, balance - monthlyPaymentAmount * k);
  }
  const growth = Math.pow(1 + monthlyRate, k);
  const b =
    balance * growth - (monthlyPaymentAmount * (growth - 1)) / monthlyRate;
  return Math.max(0, b);
}

// ---------- §2.5 Annual Interest ----------

/**
 * Interest charged over a 12-month window beginning at startMonth (0-indexed).
 *
 *   annual_interest = Σ (r_m × B_k)  for k = startMonth .. startMonth + 11
 *
 * B_k here is the balance going INTO month k's interest charge — the §2.4
 * formula evaluated at k. For year 1 of a fresh loan (startMonth = 0), the
 * first term equals r_m × B; subsequent terms decrease as principal pays
 * down, matching the documented approximation:
 *
 *   annual_interest ≈ B × r_m × 12   (slight overestimate)
 */
export function annualInterest(
  balance: Dollars,
  monthlyRate: MonthlyRate,
  monthlyPaymentAmount: Dollars,
  startMonth: number = 0,
): Dollars {
  let total = 0;
  for (let k = startMonth; k < startMonth + 12; k++) {
    const balanceGoingIn = balanceAtMonth(
      balance,
      monthlyRate,
      monthlyPaymentAmount,
      k,
    );
    total += monthlyRate * balanceGoingIn;
  }
  return total;
}
