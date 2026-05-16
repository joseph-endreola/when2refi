# when2refi.com — Product Vision and Context
*Last updated: 2026-05-14*

---

## The Problem

The mortgage industry's default UX is structured around lender-initiated contact. A homeowner who wants to evaluate a refinance fills out a form, which sells their contact information to dozens of lenders simultaneously, triggering an immediate barrage of phone calls. The calls involve salespeople who present the mortgage in whatever framing is most likely to close -- lower payment, cash-out, whatever the borrower seems receptive to -- rather than a full and honest picture of the tradeoffs.

The borrower has no way to evaluate whether a refi actually makes sense without going through this process. Most people lack the tools to calculate break-even on closing costs, total interest delta over the remaining loan life, or how resetting to a new 30-year term affects their long-term financial position. The industry profits from this information asymmetry.

The result: people either refi at the wrong time because a salesperson convinced them it was good, or they don't refi at the right time because navigating the process is too painful.

---

## The Insight

The trigger for a refinance should be fiscal logic, not sales pipeline pressure. A homeowner should be able to define what "a good refi" means for their specific situation and be notified automatically when those conditions are met -- without filling out a form, without a phone call, without talking to anyone until the math already works.

The mortgage process has no legal requirement for human-to-human interaction. E-consent, digital disclosures, automated underwriting, appraisal waivers, and Remote Online Notarization (RON -- legal in Texas and Virginia) mean the entire process from notification to funded loan can be completed digitally. The industry's reliance on phone calls is sales culture, not regulatory mandate.

---

## The Product

**when2refi.com** is an autonomous financial watchdog for homeowners and real estate investors.

It is not a lead generation tool. It is not a rate aggregator. It is a decision support and monitoring platform that is structurally on the borrower's side.

**How it works:**

1. Borrower enters their current mortgage facts into the Decision Support Calculator (DSC) -- no account required
2. The goal solver (right panel) lets them define what a good outcome looks like: reduce payment by $X, break even within Y months, pull out $Z for a new acquisition, etc.
3. The system solves backwards -- given your goal, here is the rate that achieves it
4. The borrower opts in to monitoring: "notify me when a product exists that achieves this goal"
5. A background process runs their profile against available mortgage products on Nexa's system on a scheduled basis
6. When a match is confirmed, the borrower receives a single email: "a product may meet your goal -- here's how to apply"
7. No match, no contact

The borrower controls the trigger. The math controls the notification. Nobody calls anybody.

---

## Business Model

The operator (licensed MLO under Nexa) earns commission when a loan closes. This is the same compensation structure as any mortgage loan officer.

The difference is incentive alignment. Traditional MLOs make money by closing loans regardless of whether the timing is right for the borrower. when2refi.com only closes loans when the math works for the borrower first. The commission is earned by being right, not by being persuasive.

This is not altruism. It is a structurally more honest business model that builds durable trust.

---

## Target User

**Primary beachhead: real estate investors**

Investors are the right first audience because:
- They already think in spreadsheets and make math-based decisions
- They have multiple properties -- portfolio view delivers compounding value
- They are reachable through communities like BiggerPockets and local REIA meetups
- They understand concepts like cash-on-cash return, DSCR, depreciation, and opportunity cost without explanation
- They tolerate manual data entry when the tool delivers real value

**Secondary: primary residence homeowners**

Simpler use case -- one property, rate-and-term refi math, payment and break-even focused. Larger total addressable market but less sophisticated and harder to reach without paid acquisition.

---

## Portfolio View

Registered users can manage multiple properties on a single dashboard. Each property has:
- A left panel showing current mortgage facts
- A right panel showing goal settings and the rate required to achieve them
- Multiple goals per property with AND/OR notification logic
- Property-type aware calculations (primary vs. investment)

An investor with 10 doors sees all 10 properties and their goal status in one place. When any property hits its conditions, one email fires.

---

## The Data Model (High Level)

Every property profile stored is an asset that appreciates over time. A borrower who registers at 6.8% today may not be ready for two years -- but when rates move they are already in the system with their goals defined. Re-acquisition cost is zero.

A borrower who just refinanced is still a future customer. Most MLOs lose contact after closing. when2refi.com maintains the relationship passively until conditions warrant re-engagement.

---

## Ethos and Design Principles

**Structural honesty over sales tactics.** The tool shows the full picture -- total interest paid, closing cost break-even, term reset penalty, cash-out opportunity cost -- not just the number that looks best.

**No data sharing, ever.** User mortgage data is never sold, never shared with third parties, never used for any purpose other than running their monitoring queries. This is a hard constraint, not a policy preference.

**No unsolicited contact.** The only outbound communication is a notification email triggered by a confirmed match the user explicitly opted into. No cold calls, no drip campaigns, no remarketing.

**The math does the work.** No hustle, no sales grind, no pipeline pressure. If the conditions are right the system finds it. If they aren't, silence.

**Passive by design.** At scale, the monitoring engine runs continuously against a growing portfolio of registered properties. The operator does not need to actively manage leads -- the system surfaces them when they are ready.

---

## Regulatory Context

- Operator must hold active NMLS license (Texas) before launch
- NMLS ID must appear on the website and all commercial communications
- Website does not display mortgage products or rates -- avoids TILA/Reg N advertising requirements on the public-facing tool
- Product matching occurs off-site within Nexa's licensed infrastructure
- Notification emails are CAN-SPAM compliant transactional messages
- GLBA privacy notice required -- data collection, storage, and safeguards policies must be documented and disclosed
- 24-month retention of all commercial communications required under Reg N
- Tax optimization goal type surfaces informational flag only -- no tax advice given

---

## Technical Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React + Vite + Tailwind | Deployed to Cloudflare Pages |
| Auth | Clerk | Google, Facebook, email login |
| API | Cloudflare Workers (TypeScript) | |
| Database | Cloudflare D1 (SQLite) | |
| Object storage | Cloudflare R2 | |
| Monitoring engine | Cloudflare Workers Cron Triggers | Scheduled product queries against Nexa |
| Email | Postmark | Transactional only |
| DNS / CDN | Cloudflare | Already in place |

No AWS dependency. Complete infrastructure separation from LedgerGuard Compliance.

---

## Open Questions (as of 2026-05-14)

- Nexa back-end access model: API vs. manual portal, rate data freshness, product query structure
- Bevri.ai role in Nexa's application workflow and where the MLO touchpoint is
- CTA destination in notification email -- what does the application flow look like from borrower perspective
- Whether Nexa's system supports programmatic product queries or requires manual MLO lookup

---

## What This Is Not

- Not a rate aggregator
- Not a lead generation service that sells borrower data
- Not a replacement for a licensed mortgage professional (the operator is the licensed professional)
- Not a tool that makes phone calls or initiates unsolicited contact
- Not affiliated with or dependent on any single lender's product catalog beyond Nexa's available products

---

*This document is the product context anchor for all future development sessions, Claude Code prompts, and design decisions. When in doubt, return here.*
