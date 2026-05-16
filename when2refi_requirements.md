# when2refi.com — Product Requirements
*Last updated: 2026-05-14*
*Status: Living document — add requirements as defined*

---

## R1: Public Decision Support Calculator

The Decision Support Calculator (DSC) is publicly accessible with no account, login, or personal information required.

---

## R2: DSC Two-Panel Layout

The DSC has two panels per property.

**Left panel — current mortgage facts (user inputs):**
- Property value (estimated)
- Mortgage balance
- Monthly payment
- Original term
- Start date
- Interest rate
- Mortgage type (FHA, VA, Conventional, DSCR, etc.)
- Property type (primary, investment, multi-family, etc.)
- Taxes and insurance (optional)

**Right panel — goal solver:**
- User states desired outcome (payment reduction target, break-even window, cash-out amount, term shortening)
- System solves backwards for the rate and terms required to achieve that goal
- System estimates closing costs
- Output: "Your goal requires rates to reach X% -- want us to notify you when we have a product that achieves this?"

---

## R3: Multiple Goals Per Property with Boolean Logic

Each property supports multiple goals with boolean notification logic.

- Goals can be combined with AND / OR operators
- Notification fires based on user-defined logic (any goal met OR all goals met)
- Tax optimization is a supported goal type with mandatory disclaimer language

**Supported goal types:**
- Reduce monthly payment by $X
- Achieve break-even within X months
- Reduce total interest paid
- Shorten remaining term to X years
- Cash-out $X for acquisition or other purpose
- Tax optimization (informational flag only — no specific tax advice)

---

## R4: Property-Type Aware DSC Behavior

The DSC behavior changes based on property type.

**Primary residence:**
- Mortgage-focused goals and calculations only
- Payment, break-even, total interest, term shortening
- Mortgage interest deductible only if itemizing (up to $750k loan balance)
- No depreciation
- Capital gains exclusion on sale ($250k single / $500k married) if applicable

**Investment / rental property:**
- Full decision engine surfaced
- NOI, cash flow, depreciation (27.5 year straight-line on structure), Return on Wealth (ROW)
- Hold/sell analysis
- Cash-out refi connects to ROW and capital redeployment math
- Mortgage interest fully deductible as business expense
- Depreciation recapture at sale (25%) modeled

**Cash-out refi goal:**
- Available on both property types
- Output model differs by property type
- Investment property cash-out requires assumed alternative return on redeployed capital to calculate ROW impact

---

## R5: Authentication via Clerk

- Google, Facebook, and email login supported
- Prebuilt React components for all auth UI
- JWT issued on login for all subsequent API calls
- Account creation is the conversion point from anonymous DSC user to monitored portfolio user

---

## R6: No Mortgage Products Displayed on Site

The website never displays mortgage products, rates, or lender information.

- Current state plus goal parameters generate a structured product query
- Query is executed off-site against Nexa's system
- Notification is triggered only on a confirmed match
- No rate or product information is surfaced on the public-facing site
- This keeps when2refi.com clear of TILA/Reg N advertising requirements on the public-facing tool

---

## R7: Match Notifications via Postmark Transactional Email

- **Trigger:** confirmed product match against user's property goals
- **Content:** confirmation that a potential match exists for the named property, summary of the user's stated goal, single CTA to begin application
- Email does not display specific rates, terms, or product details
- CTA destination TBD pending Nexa onboarding
- NMLS ID and required compliance language included in email footer
- CAN-SPAM compliant: physical address, opt-out mechanism, no deceptive subject lines

---

## R8: Infrastructure on Cloudflare (No AWS)

Entire when2refi.com stack runs on Cloudflare. No AWS dependency. Complete separation from LedgerGuard infrastructure.

| Layer | Technology |
|---|---|
| Frontend hosting | Cloudflare Pages |
| API / backend | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Object storage | Cloudflare R2 |
| Scheduled jobs | Cloudflare Workers Cron Triggers |
| DNS / CDN | Cloudflare |
| Auth | Clerk |
| Email | Postmark |

Cloudflare Workers Cron Triggers power the monitoring engine — scheduled queries run against Nexa's system, invisible to the user.

---

## R9: Cloudflare Workers in TypeScript

- TypeScript selected for Workers (not Python)
- Consistent with React/Vite frontend stack
- First-class D1, R2, KV, and Cron Trigger bindings
- Clerk and Postmark SDKs are TypeScript native
- Shared type definitions between frontend and backend where applicable

---

## Open Items / TBD

- CTA destination in notification email (pending Nexa onboarding)
- Nexa API / back-end access model (rate data, product query mechanism, application handoff)
- Bevri.ai integration point in Nexa workflow
- Portfolio dashboard card design details
- Data model (users, properties, goals, notification history) — next session
- Goal solver math — backwards calculation per goal type — next session
- Monitoring engine design — Cron Trigger job logic — next session

---

## Compliance Notes

- NMLS ID required on all advertising surfaces including website once licensed
- Reg N: 24-month retention required for all commercial communications
- GLBA: privacy notice required, data safeguards required, opt-out mechanism required
- CAN-SPAM: applies to all notification emails
- TILA trigger terms: avoided by not displaying specific loan products publicly
- No PII in logs
- No data sold or shared with third parties under any circumstances
