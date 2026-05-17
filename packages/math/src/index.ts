/**
 * @when2refi/math
 *
 * Pure functional core for the Decision Support Calculator. All formulas
 * derive from MATH.md. No I/O, no time, no randomness — every function is
 * deterministic and referentially transparent.
 *
 * Implementation modules will be added incrementally:
 *   - amortization (MATH.md §2)
 *   - closing costs (MATH.md §3)
 *   - solver (MATH.md §4)
 *   - goals (MATH.md §5.x)
 *   - investment (MATH.md §6)
 *   - hold-sell (MATH.md §7)
 */

export * from './types.js';
