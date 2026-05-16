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
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS properties (
  id                            TEXT    PRIMARY KEY,
  user_id                       TEXT    NOT NULL REFERENCES users(id),
  nickname                      TEXT,
  property_value_cents          INTEGER NOT NULL,
  mortgage_balance_cents        INTEGER NOT NULL,
  monthly_payment_cents         INTEGER NOT NULL,
  original_term_months          INTEGER NOT NULL,
  loan_start_date               TEXT    NOT NULL,
  interest_rate_bps             INTEGER NOT NULL,
  mortgage_type                 TEXT    NOT NULL,
  property_type                 TEXT    NOT NULL,
  taxes_insurance_monthly_cents INTEGER,
  monthly_gross_rent_cents      INTEGER,
  operating_expense_rate_bps    INTEGER DEFAULT 4000,
  purchase_price_cents          INTEGER,
  purchase_date                 TEXT,
  goal_notification_logic       TEXT    NOT NULL DEFAULT 'ANY',
  monitoring_enabled            INTEGER NOT NULL DEFAULT 0,
  created_at                    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                    TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at                    TEXT
);

CREATE INDEX IF NOT EXISTS idx_properties_user_id
  ON properties(user_id);

CREATE INDEX IF NOT EXISTS idx_properties_monitoring
  ON properties(monitoring_enabled, deleted_at);

-- ---------------------------------------------------------------------------
-- goals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS goals (
  id                 TEXT    PRIMARY KEY,
  property_id        TEXT    NOT NULL REFERENCES properties(id),
  user_id            TEXT    NOT NULL,
  goal_type          TEXT    NOT NULL,
  parameters         TEXT    NOT NULL,
  monitoring_enabled INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  superseded_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_goals_property_id
  ON goals(property_id, superseded_at);

CREATE INDEX IF NOT EXISTS idx_goals_user_id
  ON goals(user_id, superseded_at);

-- ---------------------------------------------------------------------------
-- notification_history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_history (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  property_id         TEXT NOT NULL,
  goal_ids            TEXT NOT NULL,
  goal_snapshot       TEXT NOT NULL,
  property_snapshot   TEXT NOT NULL,
  recipient_email     TEXT NOT NULL,
  postmark_message_id TEXT,
  sent_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notification_history_user
  ON notification_history(user_id, sent_at);

CREATE INDEX IF NOT EXISTS idx_notification_history_property
  ON notification_history(property_id, sent_at);
