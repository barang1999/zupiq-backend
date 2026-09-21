-- Add progression cache columns to users table.
-- These are updated on every session creation to avoid full recalculation
-- on each progression fetch.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS current_streak          INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_studied_date        DATE    NULL,
  ADD COLUMN IF NOT EXISTS unique_study_days_count  INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_session_date       DATE    NULL;
