-- when2refi.com
-- Migration: 0001_initial_schema
-- Description: Baseline schema -- users, properties, goals, notification_history
-- All monetary values stored as INTEGER cents.
-- Interest/return rates stored as INTEGER basis points (6.75% = 675).
-- Booleans stored as INTEGER (0 | 1).
-- Timestamps stored as TEXT ISO-8601 UTC.

-- ---------------------------------------------------------------------------
-- users
-- Thin Clerk reference. Auth state lives in Clerk, not here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,   -- Clerk user ID (user_xxxx)
  email      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- properties
-- One row per saved property per user. Anonymous DSC sessions are
-- client-side only and never written here.
--
-- monthly_payment_cents is P&I only. Taxes and insurance are stored
-- separately in taxes_insurance_monthly_cents and must not be included
-- in any amortization calculation.
--
-- Investment / multi_family columns (nullable on primary residence):
--   monthly_gross_rent_cents     -- required for NOI, cash flow, DSCR, ROW
--   operating_expense_rate_bps   -- default 4000 (40%). User-adjustable.
--   purchase_price_cents         -- required for depreciation base and capital gains
--   purchase_date                -- required for accumulated depreciation and holding period
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS properties (
  id                            TEXT    PRIMARY KEY,   -- UUID v4
  user_id                       TEXT    NOT NULL REFERENCES users(id),
  nickname                      TEXT,                  -- user label e.g. "123 Main St"
  property_value_cents          INTEGER NOT NULL,
  mortgage_balance_cents        INTEGER NOT NULL,
  monthly_payment_cents         INTEGER NOT NULL,      -- P&I only, not including T&I
  original_term_months          INTEGER NOT NULL,      -- 360 = 30yr, 180 = 15yr
  loan_start_date               TEXT    NOT NULL,      -- YYYY-MM-DD
  interest_rate_bps             INTEGER NOT NULL,      -- 6.75% = 675
  mortgage_type                 TEXT    NOT NULL,      -- FHA | VA | Conventional | DSCR | Other
  property_type                 TEXT    NOT NULL,      -- primary | investment | multi_family
  taxes_insurance_monthly_cents INTEGER,               -- nullable
  monthly_gross_rent_cents      INTEGER,               -- nullable; investment/multi_family only
  operating_expense_rate_bps    INTEGER DEFAULT 4000,  -- nullable; default 40%
  purchase_price_cents          INTEGER,               -- nullable; investment/multi_family only
  purchase_date                 TEXT,                  -- nullable; YYYY-MM-DD
  goal_notification_logic       TEXT    NOT NULL DEFAULT 'ANY',  -- ANY | ALL
  monitoring_enabled            INTEGER NOT NULL DEFAULT 0,
  created_at                    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                    TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at                    TEXT                   -- soft delete: set to delete, never hard-delete
);

-- Supports per-user portfolio queries
CREATE INDEX IF NOT EXISTS idx_properties_user_id
  ON properties(user_id);

-- Supports cron job: pull all active monitored properties in one scan
CREATE INDEX IF NOT EXISTS idx_properties_monitoring
  ON properties(monitoring_enabled, deleted_at);

-- ---------------------------------------------------------------------------
-- goals
-- One row per goal per property. Edited goals are soft-deleted (superseded_at
-- set) and a new row is inserted -- version boundary preserved for audit.
--
-- goal_type values:
--   payment_reduction  -- reduce monthly payment by target amount
--   break_even         -- recover closing costs within target months
--   total_interest     -- reduce total interest paid by target amount
--   term_shortening    -- shorten remaining loan term to target years
--   cash_out           -- extract target equity amount
--   tax_optimization   -- informational flag only, no calculation
--
-- parameters JSON shape by goal_type:
--   payment_reduction  { "target_reduction_cents": 20000 }
--   break_even         { "max_months": 24 }
--   total_interest     { "target_reduction_cents": 1000000 }
--   term_shortening    { "target_remaining_years": 20 }
--   cash_out           { "amount_cents": 5000000, "assumed_return_bps": 800 }
--                        assumed_return_bps: investment properties only, nullable on primary
--   tax_optimization   {}
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS goals (
  id                 TEXT    PRIMARY KEY,  -- UUID v4
  property_id        TEXT    NOT NULL REFERENCES properties(id),
  user_id            TEXT    NOT NULL,     -- denormalized for cron query efficiency
  goal_type          TEXT    NOT NULL,
  parameters         TEXT    NOT NULL,     -- JSON blob, shape defined by goal_type
  monitoring_enabled INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  superseded_at      TEXT                 -- soft delete / version boundary
);

-- Active goals for a property: WHERE property_id = ? AND superseded_at IS NULL
CREATE INDEX IF NOT EXISTS idx_goals_property_id
  ON goals(property_id, superseded_at);

-- Cron job: active monitored goals by user
CREATE INDEX IF NOT EXISTS idx_goals_user_id
  ON goals(user_id, superseded_at);

-- ---------------------------------------------------------------------------
-- notification_history
-- Append-only audit log. goal_snapshot and property_snapshot freeze the
-- state that triggered the notification -- live records can change, the
-- audit trail cannot. Satisfies Reg N 24-month retention requirement
-- for commercial communications.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_history (
  id                  TEXT PRIMARY KEY,  -- UUID v4
  user_id             TEXT NOT NULL,
  property_id         TEXT NOT NULL,
  goal_ids            TEXT NOT NULL,     -- JSON array of goal IDs that triggered
  goal_snapshot       TEXT NOT NULL,     -- JSON: full goal rows at time of match
  property_snapshot   TEXT NOT NULL,     -- JSON: full property row at time of match
  recipient_email     TEXT NOT NULL,
  postmark_message_id TEXT,              -- populated on successful Postmark send, null on failure
  sent_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-user notification history queries (account page, audit)
CREATE INDEX IF NOT EXISTS idx_notification_history_user
  ON notification_history(user_id, sent_at);

-- Per-property notification history (property detail view)
CREATE INDEX IF NOT EXISTS idx_notification_history_property
  ON notification_history(property_id, sent_at);
