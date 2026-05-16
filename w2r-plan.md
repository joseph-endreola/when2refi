# when2refi.com — Project Plan
*Last updated: 2026-05-14*

---

## Phase 1: Licensing (Blocker for Everything Else)

- [ ] Complete 20-hour NMLS required education
- [ ] Complete 3-hour Texas-specific education
- [ ] Pass NMLS licensing exam
- [ ] Receive NMLS ID
- [ ] Complete Nexa onboarding
- [ ] Understand Nexa back-end: rate data, product query mechanism, application handoff
- [ ] Understand Bevri.ai role in application workflow
- [ ] Confirm CTA destination for notification email

---

## Phase 2: Data Model and Math

- [ ] Define D1 schema: users, properties, goals, notification history
- [ ] Define goal solver math for each goal type (backwards calculation)
- [ ] Define product query structure (what gets sent to Nexa's system)
- [ ] Define ROW calculation for investment properties
- [ ] Define hold/sell analysis model

---

## Phase 3: Foundation

- [ ] Register when2refi.com on Cloudflare
- [ ] Initialize React + Vite + Tailwind project
- [ ] Deploy skeleton to Cloudflare Pages
- [ ] Set up Cloudflare Workers (TypeScript)
- [ ] Set up Cloudflare D1 database and run migrations
- [ ] Set up Cloudflare R2
- [ ] Integrate Clerk (Google, Facebook, email login)
- [ ] Wire Clerk JWT to Workers API

---

## Phase 4: Decision Support Calculator (DSC)

- [ ] Build left panel: current mortgage facts input form
- [ ] Build amortization engine: derive equity, P&I by month, remaining balance
- [ ] Build right panel: goal solver UI
- [ ] Implement backwards calculation per goal type
- [ ] Implement closing cost estimator
- [ ] Implement property-type aware behavior (primary vs. investment)
- [ ] Implement full investment decision engine (NOI, cash flow, depreciation, ROW)
- [ ] DSC works anonymously with no account required

---

## Phase 5: Portfolio Dashboard

- [ ] Build authenticated portfolio dashboard
- [ ] Card grid view: two cards per property (current state + goal state)
- [ ] List view toggle
- [ ] Add / edit / delete property
- [ ] Multiple goals per property with AND/OR boolean logic
- [ ] Goal status display per property

---

## Phase 6: Monitoring Engine

- [ ] Build product query constructor (property profile + goals → structured query)
- [ ] Set up Cloudflare Workers Cron Trigger
- [ ] Implement query execution against Nexa's system
- [ ] Implement match evaluator (does result meet goal conditions?)
- [ ] Implement notification trigger on confirmed match
- [ ] No notification fired on no match

---

## Phase 7: Notifications

- [ ] Set up Postmark account and domain
- [ ] Build match notification email template
- [ ] Include NMLS ID and compliance language in footer
- [ ] CAN-SPAM compliance: physical address, opt-out mechanism
- [ ] Wire notification trigger to Postmark send
- [ ] Test end-to-end: goal met → email fires

---

## Phase 8: Compliance and Launch Readiness

- [ ] Add NMLS ID to website
- [ ] Draft and publish GLBA privacy notice
- [ ] Implement data opt-out mechanism
- [ ] Set up Reg N 24-month content archiving (R2 versioning)
- [ ] Legal review of website copy and notification emails
- [ ] Soft launch to BiggerPockets and local REIA contacts

---

## Open Items (Blockers Until Nexa Onboarding)

- CTA destination in notification email
- Nexa API vs. manual portal access
- Product query structure and rate data freshness
- Bevri.ai integration point
