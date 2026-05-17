# when2refi.com — Product Requirements
*Last updated: 2026-05-16*
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

## R10: Static Education Page Content Scope

The Education page provides definitions and explanations for mortgage and real estate investment concepts that appear elsewhere in the product or in industry discourse.

Content is organized into five categories:

- **Mortgage glossary** — terms appearing on mortgage documents and statements (APR, P&I, LTV, DTI, escrow, PMI, MIP, amortization, points, origination, underwriting, appraisal, title, recording, prepayment penalty, rate lock, etc.)
- **Loan products** — Conventional, FHA, VA, USDA, Jumbo, DSCR, Non-QM, HELOC, HELOAN
- **Refi types** — rate-and-term, cash-out, streamline (FHA streamline, VA IRRRL)
- **Investment strategies** — buy and hold, fix and flip, BRRRR, house hacking, short-term rental, seller financing, subject-to
- **Investment metrics** — cap rate, NOI, GRM, DSCR, cash-on-cash, ROW, depreciation, recapture, 1031 exchange

Wholesaling and syndication are intentionally excluded — different audience than the beachhead investor segment.

---

## R11: Education Content Authored as TypeScript Data Files

Education entries are stored as TypeScript data files in the repository, not Markdown, JSX, or external CMS.

Rationale:
- Same data is importable by DSC components for inline tooltips (single source of truth)
- Type-checked at build, cross-link integrity verified
- No build plugin dependency
- No third-party CMS dependency (aligned with low switching costs principle)
- Version controlled, AI-assisted drafting works natively

---

## R12: Education Routes — Category Index Plus Per-Entry Pages

The Education section uses a hybrid route structure:

```
/education                      — overview hub with category filter chips
/education/{category}           — category index, alphabetical list with search-within
/education/{category}/{slug}    — full entry detail page
```

Each entry has a canonical URL, Schema.org `DefinedTerm` structured data, and individual title and meta tags. Supports SEO for high-intent queries like "what is BRRRR" and "how does DSCR work" — the beachhead investor segment.

---

## R13: Education Search and Filter

Education pages include a sticky search bar with as-you-type substring matching over `term`, `summary`, and `body` fields, weighted in that order. Top 8 results display in a dropdown, each linking directly to an entry page.

The `/education` hub displays category filter chips (All, Glossary, Loan Products, Refi Types, Strategies, Metrics) for browsing.

Explicit non-goals at MVP: no fuzzy match library, no tag or facet filtering, no URL state for queries, no Cmd-K palette. Deferred until usage justifies additional complexity.

---

## R14: Education Cross-Linking via Shared TermInfo Component

A shared `<TermInfo slug="..." />` component renders an info icon that opens a popover containing the entry's `summary` field and a "Read more" link to the entry page. The component imports directly from the Education data layer.

Usage:
- Embedded in DSC input labels and output displays
- Embedded in portfolio dashboard metric cards
- Embedded in goal builder UI

Optional `dscLink` field on each entry provides reverse linkage from Education entries back to relevant DSC features where the connection materially helps.

Inline parentheticals (e.g., "Monthly payment (P&I only, excludes taxes and insurance)") remain in labels rather than being moved into popovers, since they are required clarifications and not optional context.

---

## R15: Education Links in Notification Email Footer

Match notification emails include 2-3 contextual links to relevant Education entries based on the goal type that triggered the match. Pattern: "Goal: cash-out refi for $50,000. Learn more: [Cash-Out Refinances] [Loan-to-Value] [DSCR Loans]".

These links are part of the transactional message context and do not constitute a separate marketing channel under CAN-SPAM.

---

## R16: Education Disclaimer Architecture

Disclaimers are layered and declared in data rather than hardcoded into components.

**Layer 1 — Global site footer.** NMLS ID (once issued), Equal Housing Opportunity language, privacy policy link, terms of use, physical mailing address. Static across all pages.

**Layer 2 — Education hub disclaimer banner** at the top of `/education`. States that content is informational, defines a glossary, and does not constitute legal, tax, or financial advice. Working draft language goes through legal review in Phase 8.

**Layer 3 — Per-entry disclaimers** declared in entry data via optional `disclaimers: DisclaimerKey[]` field, rendered as a block above entry body. Keys at MVP:
- `tax` — entries touching depreciation, recapture, 1031, mortgage interest deduction. Mirrors existing MATH.md language for `tax_optimization` goal.
- `strategy_risk` — all entries in the `strategies` category.
- `eligibility` — loan product entries.

**TILA / Reg Z posture for entry copy.**

Educational content is not advertising. Worked examples, sensitivity statements, and calculator outputs are allowed. Specific rates framed as available or attainable through when2refi.com are not.

Allowed:
- Definitions of any term
- Worked examples illustrating math (e.g., "On a $300,000 loan at 6% over 30 years, total interest paid is roughly $348,000")
- Sensitivity statements (e.g., "A 1% rate change moves the payment by approximately $X on a typical loan")
- Computed outputs from user-supplied inputs

Prohibited:
- Rates or APRs framed as currently available
- Phrases like "as low as," "apply now," "best rate," "lowest in the market"
- Lender names paired with rates
- Any implication that a specific product or rate is attainable through when2refi.com

Enforced both editorially and via build-time string validation against banned phrases.

---

## R17: Education Build Sequencing — Phase 4.5

Education page work occupies a new Phase 4.5 in w2r-plan.md, between Phase 4 (DSC) and Phase 5 (Portfolio Dashboard). Phase 5+ numbering is unchanged. Detailed task list lives in the plan document.

Rationale:
- DSC math (MATH.md) is the source of truth for which entries need to exist
- TermInfo wiring requires DSC to be functional first
- Portfolio Dashboard reuses the same TermInfo component pattern
- Education can soft-launch publicly while NMLS licensing finishes, supporting SEO ramp without violating R7

---

## R18: Education Data Schema

A single TypeScript type defines all entries across all categories, with optional fields rendered by the entry detail component where present.

```typescript
type Category =
  | 'glossary'
  | 'loan-products'
  | 'refi-types'
  | 'strategies'
  | 'metrics';

type DisclaimerKey = 'tax' | 'strategy_risk' | 'eligibility';

type EducationEntry = {
  // Required, all categories
  slug: string;                    // kebab-case, url-safe
  term: string;                    // display name, e.g. "Loan-to-Value (LTV)"
  category: Category;
  summary: string;                 // one-line, used in tooltips and list views
  body: string[];                  // paragraph array, main exposition
  related: string[];               // slugs of related entries

  // Optional, all categories
  dscLink?: string;                // route to relevant DSC feature
  disclaimers?: DisclaimerKey[];

  // Optional structured fields, rendered where present
  formula?: string;                // glossary, metrics
  eligibility?: string[];          // loan-products
  keyFeatures?: string[];          // loan-products, refi-types
  keyLimitations?: string[];       // loan-products, refi-types
  whenToConsider?: string[];       // refi-types, strategies
  whenNotToConsider?: string[];    // refi-types, strategies
  phases?: { name: string; description: string }[];  // strategies
  risks?: string[];                // strategies
  capitalRequirements?: string[];  // strategies
  typicalTimeline?: string;        // strategies
  interpretation?: string[];       // metrics
  pitfalls?: string[];             // metrics
};
```

Build-time validation enforced via a CI script:
- Every `related[]` slug resolves to an existing entry
- Every `disclaimers[]` key exists in `disclaimers.ts`
- Every `dscLink` matches a known route pattern
- Slug uniqueness across all categories
- `term` follows convention "Full Name (Acronym)" where applicable
- `body[]` paragraphs contain no banned phrases per R16 TILA posture

Conventions:
- Slugs: kebab-case, ASCII only
- Terms: full name first, acronym in parens — "Debt Service Coverage Ratio (DSCR)"
- Body paragraphs: one paragraph per array element, plain strings (rendering controlled by entry detail component)
- Numbers in body text follow R16 TILA posture — worked examples and sensitivity statements only

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
