# when2refi.com — Project Plan
*Last updated: 2026-05-16*

## Phase 1: Licensing (Blocker for Everything Else)

- [ ] Complete 20-hour NMLS required education
- [ ] Complete 3-hour Texas-specific education
- [ ] Pass NMLS licensing exam
- [ ] Receive NMLS ID
- [ ] Complete Nexa onboarding
- [ ] Understand Nexa back-end: rate data, product query mechanism, application handoff
- [ ] Understand Bevri.ai role in application workflow
- [ ] Confirm CTA destination for notification email

## Phase 2: Data Model and Math

- [x] Define D1 schema: users, properties, goals, notification history
- [x] Define goal solver math for each goal type (backwards calculation)
- [x] Define product query structure (what gets sent to Nexa's system)
- [x] Define ROW calculation for investment properties
- [x] Define hold/sell analysis model

## Phase 3: Foundation

- [x] Register when2refi.com on Cloudflare
- [x] Initialize React + Vite + Tailwind project
- [x] Deploy skeleton to Cloudflare Pages
- [x] Set up Cloudflare Workers (TypeScript)
- [x] Set up Cloudflare D1 database and run migrations
- [x] Set up Cloudflare R2 (bucket: when2refi-assets, bound to Worker)
- [x] Integrate Clerk (Google, Facebook, email login)
- [x] Wire Clerk JWT to Workers API (RS256 via JWKS, JWKS cache, public/protected route split)

## Phase 4: Decision Support Calculator (DSC)

- [ ] Build left panel: current mortgage facts input form
- [ ] Build amortization engine: derive equity, P&I by month, remaining balance
- [ ] Build right panel: goal solver UI
- [ ] Implement backwards calculation per goal type
- [ ] Implement closing cost estimator
- [ ] Implement property-type aware behavior (primary vs. investment)
- [ ] Implement full investment decision engine (NOI, cash flow, depreciation, ROW)
- [ ] DSC works anonymously with no account required

## Phase 4.5: Static Education Page

- [ ] Define Education TypeScript types (`EducationEntry`, `Category`, `DisclaimerKey`)
- [ ] Create `disclaimers.ts` with `tax`, `strategy_risk`, `eligibility` working draft language
- [ ] Build CI validation script (slug uniqueness, `related[]` integrity, disclaimer keys, `dscLink` route check, banned phrase check)
- [ ] Scaffold route structure under `src/pages/education/` — hub, category index, entry detail
- [ ] Build `<TermInfo>` shared popover component (used by DSC, dashboard, goal builder)
- [ ] Build sticky search bar with substring match (as-you-type dropdown, top 8 results)
- [ ] Build category filter chips on `/education` hub
- [ ] Draft glossary category entries (full mortgage glossary per R10 scope)
- [ ] Draft loan products category entries (Conventional, FHA, VA, USDA, Jumbo, DSCR, Non-QM, HELOC, HELOAN)
- [ ] Draft refi types category entries (rate-and-term, cash-out, FHA streamline, VA IRRRL)
- [ ] Draft strategies category entries (buy and hold, fix and flip, BRRRR, house hacking, STR, seller financing, subject-to)
- [ ] Draft metrics category entries (cap rate, NOI, GRM, DSCR, cash-on-cash, ROW, depreciation, recapture, 1031 exchange)
- [ ] Wire `<TermInfo>` to DSC inputs and outputs (depends on Phase 4 progress)
- [ ] Generate sitemap entries for all Education routes
- [ ] Add Schema.org `DefinedTerm` structured data on entry pages
- [ ] Add NMLS ID placeholder slot in global footer (filled when Phase 1 closes)
- [ ] Soft launch Education page to BiggerPockets and local REIA contacts (ahead of full Phase 8 launch)

## Phase 5: Portfolio Dashboard

- [ ] Build authenticated portfolio dashboard
- [ ] Card grid view: two cards per property (current state + goal state)
- [ ] List view toggle
- [ ] Add / edit / delete property
- [ ] Multiple goals per property with AND/OR boolean logic
- [ ] Goal status display per property

## Phase 6: Monitoring Engine

- [ ] Build product query constructor (property profile + goals → structured query)
- [ ] Set up Cloudflare Workers Cron Trigger
- [ ] Implement query execution against Nexa's system
- [ ] Implement match evaluator (does result meet goal conditions?)
- [ ] Implement notification trigger on confirmed match
- [ ] No notification fired on no match

## Phase 7: Notifications

- [ ] Set up Postmark account and domain
- [ ] Build match notification email template
- [ ] Include NMLS ID and compliance language in footer
- [ ] CAN-SPAM compliance: physical address, opt-out mechanism
- [ ] Wire notification trigger to Postmark send
- [ ] Test end-to-end: goal met → email fires

## Phase 8: Compliance and Launch Readiness

- [ ] Add NMLS ID to website
- [ ] Draft and publish GLBA privacy notice
- [ ] Implement data opt-out mechanism
- [ ] Set up Reg N 24-month content archiving (R2 versioning)
- [ ] Legal review of website copy and notification emails
- [ ] Soft launch to BiggerPockets and local REIA contacts

## Open Items (Blockers Until Nexa Onboarding)

- CTA destination in notification email
- Nexa API vs. manual portal access
- Product query structure and rate data freshness
- Bevri.ai integration point
