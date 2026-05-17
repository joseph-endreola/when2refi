// Closing cost estimation for MATH.md §3.
// Pure function. UI-layer estimate only, never stored in D1.

import type { Dollars } from './units';

/**
 * Default closing cost ratio per MATH.md §3: 2.5% of loan balance.
 * Typical range 2.0% to 3.0%. The user may adjust this in the right
 * panel before the rate solver runs.
 */
export const DEFAULT_CLOSING_COST_RATIO = 0.025;

/**
 * Estimated closing cost.
 *
 *   CC = B × ratio
 *
 * MATH.md §3. UI-layer estimate only. Closing costs are not stored in D1,
 * and the breakdown (origination, appraisal, title, recording) is a
 * display-only transparency aid not represented in this function.
 *
 * Default ratio is DEFAULT_CLOSING_COST_RATIO (0.025). Callers may pass
 * a user-adjusted ratio.
 */
export function closingCostEstimate(
  balance: Dollars,
  ratio: number = DEFAULT_CLOSING_COST_RATIO,
): Dollars {
  return balance * ratio;
}
