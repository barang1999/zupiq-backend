-- Add AI token usage tracking columns to study_sessions
ALTER TABLE study_sessions
  ADD COLUMN IF NOT EXISTS prompt_tokens     INTEGER,
  ADD COLUMN IF NOT EXISTS completion_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS total_tokens      INTEGER,
  ADD COLUMN IF NOT EXISTS ai_cost_usd       NUMERIC(10, 6);
