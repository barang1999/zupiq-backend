-- Stores user thumbs-up / thumbs-down signals on AI-generated session breakdowns.
-- One row per (session_id, user_id) — upserted on each rating change.

CREATE TABLE IF NOT EXISTS breakdown_feedback (
  session_id  TEXT        NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
  user_id     TEXT        NOT NULL REFERENCES users(id)           ON DELETE CASCADE,
  signal      TEXT        NOT NULL CHECK (signal IN ('positive', 'negative')),
  reasons     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_breakdown_feedback_user_id    ON breakdown_feedback (user_id);
CREATE INDEX IF NOT EXISTS idx_breakdown_feedback_signal     ON breakdown_feedback (signal);
CREATE INDEX IF NOT EXISTS idx_breakdown_feedback_updated_at ON breakdown_feedback (updated_at DESC);
