# when2refi.com -- D1 Schema Reference
*Last updated: 2026-05-14*

---

## Conventions

| Data type | Storage format | Example |
|---|---|---|
| Monetary values | INTEGER cents | $6.75 = 675 |
| Interest / return rates | INTEGER basis points | 6.75% = 675 |
| Booleans | INTEGER 0 or 1 | enabled = 1 |
| Timestamps | TEXT ISO-8601 UTC | 2026-05-14T12:00:00Z |
| Primary keys | TEXT UUID v4 | generated application-side |
| Soft deletes | `deleted_at` or `superseded_at` TEXT, null = active | never hard-delete |

---

## Tables

### `users`

Thin Clerk reference. Clerk owns all auth state. D1 stores only what is needed
to associate properties and send notifications.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | Clerk user ID (user_xxxx) |
| email | TEXT | Notification delivery address |
| created_at | TEXT | |
| updated_at | TEXT | |

---

### `properties`

One row per saved property per user. Anonymous DSC sessions are client-side
only and are never written to D1. On sign-in, the frontend POSTs the current
DSC state and it becomes the user's first property row.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID v4 |
| user_id | TEXT FK | References users(id) |
| nickname | TEXT | User-defined label. Nullable |
| property_value_cents | INTEGER | |
| mortgage_balance_cents | INTEGER | |
| monthly_payment_cents | INTEGER | P&I only. Does not include taxes or insurance |
| original_term_months | INTEGER | 360 = 30yr, 180 = 15yr |
| loan_start_date | TEXT | YYYY-MM-DD |
| interest_rate_bps | INTEGER | 6.75% = 675 |
| mortgage_type | TEXT | FHA, VA, Conventional, DSCR, Other |
| property_type | TEXT | primary, investment, multi_family |
| taxes_insurance_monthly_cents | INTEGER | Nullable |
| monthly_gross_rent_cents | INTEGER | Nullable. Investment / multi_family only. Required for NOI, cash flow, DSCR, ROW |
| operating_expense_rate_bps | INTEGER | Nullable. Default 4000 (40%). User-adjustable |
| purchase_price_cents | INTEGER | Nullable. Investment / multi_family only. Required for depreciation base and capital gains |
| purchase_date | TEXT | Nullable. YYYY-MM-DD. Required for accumulated depreciation and holding period |
| goal_notification_logic | TEXT | ANY or ALL -- applies to all goals on this property |
| monitoring_enabled | INTEGER | 0 = off, 1 = active in cron engine |
| created_at | TEXT | |
| updated_at | TEXT | |
| deleted_at | TEXT | Null = active. Set to soft-delete. Never hard-delete |

**Indexes:**
- `idx_properties_user_id` on `(user_id)` -- portfolio queries
- `idx_properties_monitoring` on `(monitoring_enabled, deleted_at)` -- cron engine scan

---

### `goals`

One row per goal per property. Goals are never updated in place. When a user
edits a goal, the existing row gets `superseded_at` set and a new row is
inserted. This preserves the version boundary so notification_history can
reference the goal state that triggered a match.

Active goals for a property: `WHERE property_id = ? AND superseded_at IS NULL`

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID v4 |
| property_id | TEXT FK | References properties(id) |
| user_id | TEXT | Denormalized for cron query efficiency |
| goal_type | TEXT | See types below |
| parameters | TEXT | JSON blob. Shape varies by goal_type |
| monitoring_enabled | INTEGER | Individual goal on/off. 0 = skip in cron |
| created_at | TEXT | |
| superseded_at | TEXT | Null = current version. Set when goal is edited |

**goal_type values and parameters shape:**

| goal_type | parameters JSON | Notes |
|---|---|---|
| `payment_reduction` | `{"target_reduction_cents": 20000}` | Reduce payment by $200/mo |
| `break_even` | `{"max_months": 24}` | Recover closing costs within 24 months |
| `total_interest` | `{"target_reduction_cents": 1000000}` | Reduce total interest by $10k |
| `term_shortening` | `{"target_remaining_years": 20}` | Shorten remaining term |
| `cash_out` | `{"amount_cents": 5000000, "assumed_return_bps": 800}` | `assumed_return_bps` is investment-only, nullable on primary |
| `tax_optimization` | `{}` | Informational flag only. No calculation. Mandatory disclaimer on render |

**Indexes:**
- `idx_goals_property_id` on `(property_id, superseded_at)` -- active goals per property
- `idx_goals_user_id` on `(user_id, superseded_at)` -- cron engine: active goals per user

---

### `notification_history`

Append-only. Never updated after insert. `goal_snapshot` and
`property_snapshot` freeze the state that triggered the notification -- the
live property and goal records may change, but the audit record cannot.

Satisfies Reg N 24-month retention requirement for commercial communications.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | UUID v4 |
| user_id | TEXT | |
| property_id | TEXT | |
| goal_ids | TEXT | JSON array of goal IDs that triggered |
| goal_snapshot | TEXT | JSON: full goal rows at time of match |
| property_snapshot | TEXT | JSON: full property row at time of match |
| recipient_email | TEXT | Where the notification was sent |
| postmark_message_id | TEXT | Postmark message ID. Null on send failure |
| sent_at | TEXT | |

**Indexes:**
- `idx_notification_history_user` on `(user_id, sent_at)`
- `idx_notification_history_property` on `(property_id, sent_at)`

---

## Tables Not Yet Defined (Future Migrations)

### `monitoring_job_log` (Phase 6)
Tracks when each property was last checked by the cron engine and the result.
Required before the monitoring engine is built. Will be defined in the Phase 6
schema migration.

### `email_preferences` (Phase 7)
CAN-SPAM requires an opt-out mechanism. A boolean on `users` or a separate
preferences table. Will be defined before Phase 7 work begins.

---

## Applying Migrations

Migrations live in `migrations/` at the repo root and are numbered sequentially.
Apply with Wrangler:

```bash
npx wrangler d1 migrations apply when2refi-db
```

For local development:

```bash
npx wrangler d1 migrations apply when2refi-db --local
```

Each migration file is applied exactly once. Do not edit a migration after it
has been applied to any environment. Add a new numbered file for schema changes.
