# when2refi.com -- DSC Math Specification
*Last updated: 2026-05-14*

---

## 1. Conventions and Units

All calculations are performed in dollars (converted from stored cents at the boundary).
All rates are in decimal form internally (6.75% = 0.0675), converted from stored basis points
at the boundary. Outputs displayed as percentages or dollars; stored as cents and basis points.

| Stored format | Conversion to working value |
|---|---|
| `_cents` fields | divide by 100 → dollars |
| `_bps` fields | divide by 10000 → decimal rate |
| Monthly rate | annual_rate / 12 |
| Annual rate → bps output | round(r_annual × 10000) |

---

## 2. Amortization Engine

### 2.1 Standard Monthly Payment

```
P(B, r_m, n) = B × r_m × (1 + r_m)^n / ((1 + r_m)^n - 1)
```

- `B` — loan balance (dollars)
- `r_m` — monthly interest rate = `interest_rate_bps / 10000 / 12`
- `n` — term in months
- `P` — monthly P&I payment (dollars)

Edge case: `r_m = 0` → `P = B / n`

`monthly_payment_cents` stores P&I only. Taxes and insurance are stored
separately in `taxes_insurance_monthly_cents` and must not be included in
any amortization calculation.

### 2.2 Deriving Remaining Term

```
months_elapsed = floor(months between loan_start_date and today)
n_remaining    = original_term_months - months_elapsed
```

Validate: `n_remaining > 0`. If zero or negative, the loan is at or past
maturity -- flag for the user, do not run goal solver.

### 2.3 Remaining Interest on Current Loan

```
RI_current = P_current × n_remaining - B
```

Total future P&I payments minus remaining principal. Always positive for
a performing loan.

### 2.4 Balance at Month k (for amortization schedules)

```
B_k = B × (1 + r_m)^k - P × ((1 + r_m)^k - 1) / r_m
```

Useful for annual interest summaries (tax optimization goal) and hold/sell
projection.

### 2.5 Annual Interest Paid (current year)

```
annual_interest = sum of (r_m × B_k) for k = 0 to 11
```

Where `B_k` is the balance at the start of month `k` using 2.4 above.
Approximation for display: `annual_interest ≈ B × r_m × 12` (slight overestimate;
use exact amortization schedule for the tax optimization output).

---

## 3. Closing Cost Estimation

Default estimate: 2.5% of loan balance.

```
CC = B × 0.025
```

This is a UI-layer estimate only -- it is not stored in the database.
The user can adjust it in the right panel before solving. Typical range 2--3%.

Breakdown shown for transparency (not used in math -- display only):

| Item | Estimate |
|---|---|
| Origination fee | 0.5%--1.0% of loan |
| Appraisal | $650 |
| Title and escrow | $1,100 |
| Recording fees | $200 |
| Remainder | to reach 2.5% |

---

## 4. Rate Solver Algorithm

All goal types except `cash_out` (when purely equity-constrained) and
`tax_optimization` reduce to: given a target payment `P_target`, balance
`B`, and term `n`, solve for the monthly rate `r_m`.

### 4.1 Feasibility Check

Before running the solver:

```
P_floor = B / n          (payment at r_m = 0, minimum to retire balance in n months)
```

If `P_target < P_floor`: infeasible regardless of rate. Display:
"Even at 0% interest, retiring this balance in [n] months requires $[P_floor]/mo."

### 4.2 Bisection Search

```
r_lo = 0.0001 / 12       (0.01% annual -- absolute floor)
r_hi = 0.20 / 12         (20% annual -- ceiling)

if P(r_lo, B, n) >= P_target:
    result = r_lo or below -- goal achievable at near-zero rates
    (show as "achievable at any realistic rate")

if P(r_hi, B, n) < P_target:
    result = infeasible at realistic rates
    (show as "requires rates above 20% -- goal not achievable as stated")

otherwise: bisect
  for 100 iterations:
    r_mid = (r_lo + r_hi) / 2
    if P(r_mid, B, n) > P_target:
        r_hi = r_mid
    else:
        r_lo = r_mid
    if (r_hi - r_lo) < 1e-10: break

r_m = (r_lo + r_hi) / 2
```

### 4.3 Output Conversion

```
annual_rate_bps = round(r_m × 12 × 10000)
```

This is the rate displayed to the user and compared against the monitoring
threshold: "your goal requires rates to reach X.XX%."

---

## 5. Goal Solvers

All goal solvers accept the current property facts and goal parameters and
return `required_rate_bps` plus supporting display values.

### 5.1 Payment Reduction

**Goal:** Reduce monthly P&I by at least `target_reduction` dollars.

**Inputs (from goal `parameters` JSON):**
- `target_reduction_cents`

**UI inputs (not stored -- right panel):**
- `new_term_months`: user-selectable. Default 360. Options: 360, 240, 180.

```
P_target   = P_current - (target_reduction_cents / 100)
B_new      = B                          (rate-and-term refi, same balance)
n_new      = new_term_months

run feasibility check
run rate solver → required_rate_bps
```

**Displayed outputs:**
- `required_rate_bps` — the rate the goal needs
- `monthly_savings` = `target_reduction_cents / 100`
- `CC` = closing cost estimate
- `break_even_months` = `CC / monthly_savings`
- `RI_new` = `P_target × n_new - B_new`
- `total_interest_delta` = `RI_current - RI_new`
  - Positive: savings. Negative: more total interest (term reset penalty).
- **Term reset warning:** if `n_new > n_remaining`, surface prominently:
  "Resetting to a [n_new/12]-year term adds [n_new - n_remaining] months of payments.
  At this rate, total interest [increases by / decreases by] $[abs(total_interest_delta)]."

---

### 5.2 Break-Even

**Goal:** Recover closing costs within `max_months`.

**Inputs:**
- `max_months`

**UI inputs:**
- `new_term_months`: default 360.
- `closing_cost_override` (optional, defaults to `B × 0.025`).

```
CC                  = closing_cost_override ?? B × 0.025
min_monthly_savings = CC / max_months
P_target            = P_current - min_monthly_savings
B_new               = B
n_new               = new_term_months

run feasibility check
run rate solver → required_rate_bps
```

**Displayed outputs:**
- `required_rate_bps`
- `min_monthly_savings` — the savings/month required
- `break_even_months` = `max_months` (by definition -- confirmation display)
- `total_interest_delta` = `RI_current - (P_target × n_new - B_new)`
- Term reset warning (same as 5.1)

---

### 5.3 Total Interest Reduction

**Goal:** Reduce total interest paid (net of closing costs) by at least
`target_reduction` dollars.

**Inputs:**
- `target_reduction_cents`

**UI inputs:**
- `new_term_months`: default `n_remaining` (same remaining term -- important).
  Term reset here has a direct, large effect on the result and must be flagged.

```
CC         = B × 0.025
RI_current = P_current × n_remaining - B

target_RI_new = RI_current - (target_reduction_cents / 100) - CC
P_target      = (target_RI_new + B) / n_new
B_new         = B
n_new         = new_term_months

run feasibility check
run rate solver → required_rate_bps
```

**Displayed outputs:**
- `required_rate_bps`
- `RI_current` — total interest remaining at current rate
- `gross_interest_savings` = `RI_current - (P_target × n_new - B)`
- `net_interest_savings` = `gross_interest_savings - CC`
- **Term reset warning:** if `n_new > n_remaining`, show the interest cost of
  the term extension separately so it is not obscured by the rate improvement.

---

### 5.4 Term Shortening

**Goal:** Pay off the loan in `target_remaining_years` without increasing
current P&I payment.

**Inputs:**
- `target_remaining_years`

```
n_target   = target_remaining_years × 12
P_target   = P_current          (payment-neutral)
B_new      = B

run feasibility check using n_target:
  P_floor = B / n_target
  if P_current < P_floor:
    infeasible: "Your current payment of $[P_current]/mo cannot retire
    $[B] in [target_remaining_years] years. Minimum payment required:
    $[P_floor]/mo."
    (also show: payment needed at current rate for n_target months)

run rate solver (B, P_current, n_target) → required_rate_bps
```

If solver returns `r_m <= 0`: balance is small enough that the current payment
already overpays for the target term at any positive rate. Display:
"Your current payment retires this balance in under [target_remaining_years] years
at any rate. No refi required."

**Displayed outputs:**
- `required_rate_bps` — maximum rate that achieves the target term at current payment
- `years_saved` = `(n_remaining - n_target) / 12`
- `RI_new` = `P_current × n_target - B`
- `interest_savings` = `RI_current - RI_new` (always positive for shorter term at same payment)
- No break-even calculation -- payment does not change.

**Secondary forward display:**
At current market rate `r_market`, what payment is required for `n_target` months?
```
P_required = P(B, r_market / 12, n_target)
payment_increase = P_required - P_current
```
Show alongside the backwards result: "At [r_market]%, a [target_remaining_years]-year
term requires $[P_required]/mo -- $[payment_increase] more than your current payment."

---

### 5.5 Cash-Out

**Goal:** Extract `amount_cents` of equity. Investment properties: evaluate
ROW impact at `assumed_return_bps` on redeployed capital.

**Inputs:**
- `amount_cents`
- `assumed_return_bps` (investment/multi_family only; nullable on primary)

**UI inputs:**
- `new_term_months`: default 360.
- Closing costs: assume paid out of pocket (not rolled into new balance) for rate solve.

```
cash_out  = amount_cents / 100
B_new     = B + cash_out
LTV_new   = B_new / property_value

max_LTV   = 0.80  (primary)
          = 0.75  (investment or multi_family)

if LTV_new > max_LTV:
  max_cash_out = property_value × max_LTV - B
  display: "Maximum cash-out at [max_LTV×100]% LTV: $[max_cash_out]"
  return early -- goal infeasible as stated

P_target  = P_current           (payment-neutral solve)
n_new     = new_term_months

run feasibility check (B_new, P_current, n_new)
run rate solver → required_rate_bps
```

If payment-neutral is infeasible (new balance too large for current payment at any rate):
Show minimum payment at a range of realistic rates instead of a single required rate.

**Primary residence displayed outputs:**
- `required_rate_bps` (payment-neutral) or payment table
- `LTV_new`
- `equity_remaining` = `property_value - B_new`
- `CC` = closing cost estimate (separate from cash-out)

**Investment / multi_family: ROW analysis**

Requires: `monthly_gross_rent_cents`, `operating_expense_rate_bps`.

```
annual_gross_rent      = monthly_gross_rent_cents/100 × 12
operating_expenses     = annual_gross_rent × (operating_expense_rate_bps / 10000)
NOI                    = annual_gross_rent - operating_expenses

-- Before refi
ADS_before             = P_current × 12
cash_flow_before       = NOI - ADS_before
equity_before          = property_value - B
ROW_before_bps         = round(cash_flow_before / equity_before × 10000)
DSCR_before            = NOI / ADS_before

-- After refi (at required rate, new term, new balance)
P_new                  = P(B_new, required_rate_m, n_new)
ADS_after              = P_new × 12
cash_flow_after        = NOI - ADS_after
equity_after           = property_value - B_new
ROW_after_bps          = round(cash_flow_after / equity_after × 10000)
DSCR_after             = NOI / ADS_after

-- Redeployed capital
redeployed_return      = cash_out × (assumed_return_bps / 10000)
total_return_after     = cash_flow_after + redeployed_return
total_return_delta     = total_return_after - cash_flow_before
```

Display: before/after table showing payment, cash flow, DSCR, ROW, and total
return (cash flow + redeployed). Flag if DSCR_after < 1.25 (DSCR loan threshold).

---

### 5.6 Tax Optimization

**No backwards calculation. Informational display only.**
Mandatory disclaimer on every render (no exceptions):
"This is for informational purposes only and does not constitute tax advice.
Consult a qualified tax professional for guidance specific to your situation."

**Primary residence:**

```
annual_interest = sum of (r_m × B_k) for k = 0 to 11   (see 2.5)
deductible_balance_cap = 75000000   (cents -- $750,000 IRS limit)

if mortgage_balance_cents <= deductible_balance_cap:
  fully_deductible = true
  deductible_interest = annual_interest
else:
  deductible_interest = annual_interest × (750000 / (mortgage_balance_cents/100))

if marginal_tax_rate provided:
  estimated_tax_benefit = deductible_interest × marginal_tax_rate
```

Display note: deductibility applies only if itemizing. Standard deduction
($14,600 single / $29,200 married in 2024 -- display year-appropriate figure)
must be exceeded for itemizing to benefit the borrower.

**Investment / multi_family:**

```
annual_interest        = sum of (r_m × B_k) for k = 0 to 11

if purchase_price_cents and purchase_date provided:
  structure_value      = purchase_price_cents/100 × 0.80
  annual_depreciation  = structure_value / 27.5
  months_held          = months between purchase_date and today
  years_held           = months_held / 12
  accumulated_depr     = min(annual_depreciation × years_held, structure_value)
else:
  annual_depreciation  = (property_value × 0.80) / 27.5   (estimated from current value)
  accumulated_depr     = null  (cannot estimate without purchase date)

combined_annual_deduction = annual_interest + annual_depreciation

if marginal_tax_rate provided:
  estimated_tax_shield = combined_annual_deduction × marginal_tax_rate
```

Surface depreciation recapture flag (display only, no calculation):
"Note: accumulated depreciation is subject to 25% recapture tax upon sale."

---

## 6. Investment Property Metrics (Full Decision Engine)

Displayed on the left panel when `property_type` is `investment` or
`multi_family`. Requires `monthly_gross_rent_cents` to be populated.

```
annual_gross_rent      = monthly_gross_rent_cents/100 × 12
operating_expenses     = annual_gross_rent × (operating_expense_rate_bps / 10000)
NOI                    = annual_gross_rent - operating_expenses

ADS                    = monthly_payment_cents/100 × 12       (annual debt service)
cash_flow_annual       = NOI - ADS
cash_flow_monthly      = cash_flow_annual / 12

cap_rate_bps           = round(NOI / property_value × 10000)
GRM                    = property_value / annual_gross_rent    (gross rent multiplier)
DSCR                   = NOI / ADS

equity                 = property_value - mortgage_balance_cents/100
ROW_bps                = round(cash_flow_annual / equity × 10000)

-- Depreciation (requires purchase_price_cents and purchase_date)
structure_value        = purchase_price_cents/100 × 0.80
annual_depreciation    = structure_value / 27.5
months_held            = months between purchase_date and today
years_held             = months_held / 12
accumulated_depr       = min(annual_depreciation × years_held, structure_value)
adjusted_cost_basis    = purchase_price_cents/100 - accumulated_depr
```

Display as a metrics card below the left panel inputs for investment properties.
DSCR below 1.00 is a cash flow warning. DSCR below 1.25 is a DSCR loan
eligibility warning.

Operating expense rate default is 40% (`operating_expense_rate_bps = 4000`).
User can adjust. Typical range 30%--50% depending on property type and management.

---

## 7. Hold / Sell Analysis

Available for investment and multi_family properties. Requires `purchase_price_cents`
and `purchase_date`. Projection horizon: user-selectable (5yr default, 7yr, 10yr).

**User-adjustable assumptions (not stored -- UI state):**

| Assumption | Default |
|---|---|
| Annual appreciation rate | 3% (300 bps) |
| Annual rent growth rate | 2% (200 bps) |
| Agent commission on sale | 6% |
| Sale closing costs | 1% |
| Long-term capital gains rate | 15% |
| Marginal income tax rate | optional |
| Reinvestment return (sell scenario) | matches `assumed_return_bps` or 7% default |

### 7.1 Sell Scenario

```
sale_price             = property_value          (today's estimated value)
agent_commission       = sale_price × 0.06
sale_closing_costs     = sale_price × 0.01
net_before_tax         = sale_price - agent_commission - sale_closing_costs - mortgage_balance

gain                   = sale_price - adjusted_cost_basis
dep_recapture_tax      = accumulated_depr × 0.25
long_term_gain         = max(0, gain - accumulated_depr)
cap_gains_tax          = long_term_gain × cap_gains_rate      (default 0.15)

net_proceeds           = net_before_tax - dep_recapture_tax - cap_gains_tax

-- Project net_proceeds at reinvestment_return for horizon years
FV_sell                = net_proceeds × (1 + reinvestment_return)^projection_years
```

### 7.2 Hold Scenario

For each year `y` from 1 to `projection_years`:

```
pv_y                   = property_value × (1 + appreciation_rate)^y
rent_y                 = monthly_gross_rent_cents/100 × 12 × (1 + rent_growth_rate)^y
expenses_y             = rent_y × (operating_expense_rate_bps / 10000)
NOI_y                  = rent_y - expenses_y
cash_flow_y            = NOI_y - ADS                          (ADS fixed -- fixed rate)
balance_y              = B_y                                  (from amortization 2.4)
equity_y               = pv_y - balance_y
```

Cumulative hold value at year `y`:

```
cumulative_cash_flow_y = sum of cash_flow_1 through cash_flow_y

if marginal_tax_rate provided:
  dep_shield_y         = annual_depreciation × marginal_tax_rate
  cumulative_tax_y     = dep_shield_y × y
else:
  cumulative_tax_y     = 0

total_hold_value_y     = cumulative_cash_flow_y + equity_y + cumulative_tax_y
```

### 7.3 Comparison Output

Display as a year-by-year table and a crossover chart:

| Year | Hold value | Sell + reinvest | Difference |
|---|---|---|---|
| 1 | ... | ... | ... |
| ... | | | |
| n | ... | ... | ... |

**Crossover year:** the first year where `total_hold_value_y > FV_sell_y`.
If no crossover within the projection horizon, display: "Selling outperforms
holding for the full [n]-year projection at these assumptions."

Note: hold/sell output is projection-based and assumption-sensitive. Prominently
surface the key assumptions and their defaults so the user understands the drivers.

---

## 8. Product Query Structure

Sent to Nexa's system by the monitoring engine when checking for matches.
This is a structured representation of the property profile and goal state.
The exact API format depends on Nexa onboarding (TBD) but the data payload
is defined here.

```json
{
  "property_id": "uuid",
  "property_type": "primary | investment | multi_family",
  "mortgage_type": "FHA | VA | Conventional | DSCR | Other",
  "loan_balance": 325000,
  "property_value": 450000,
  "ltv": 0.722,
  "goals": [
    {
      "goal_type": "payment_reduction",
      "required_rate_bps": 575,
      "new_term_months": 360,
      "parameters": { "target_reduction_cents": 25000 }
    },
    {
      "goal_type": "break_even",
      "required_rate_bps": 600,
      "new_term_months": 360,
      "parameters": { "max_months": 24 }
    }
  ],
  "goal_notification_logic": "ANY",
  "query_timestamp": "2026-05-14T12:00:00Z"
}
```

The monitoring engine computes `required_rate_bps` for each active goal
at query time using current property facts. It does not store the required rate
permanently -- it is derived fresh on each cron run in case property facts
have been updated.

**Match condition:**
A product match exists if Nexa returns a product where:
- Loan type is compatible with `mortgage_type` and `property_type`
- LTV is within product limits
- Offered rate <= `required_rate_bps` for any matching goal (ANY logic)
  or all matching goals (ALL logic)

---

## 9. Schema Additions Required

The following columns must be added to the `properties` table to support
the full investment decision engine. These are nullable and only relevant
for `property_type` of `investment` or `multi_family`.

| Column | Type | Notes |
|---|---|---|
| `monthly_gross_rent_cents` | INTEGER NULL | Required for NOI, cash flow, DSCR, ROW |
| `operating_expense_rate_bps` | INTEGER NULL DEFAULT 4000 | 40% default. User-adjustable |
| `purchase_price_cents` | INTEGER NULL | Required for depreciation and capital gains |
| `purchase_date` | TEXT NULL | YYYY-MM-DD. Required for accumulated depreciation |

Future addition (not in current schema): `marginal_tax_rate_bps` -- to be wired
from property address (zip-based lookup) in a future release. Optional field.
Store as INTEGER basis points. NULL = not provided.
