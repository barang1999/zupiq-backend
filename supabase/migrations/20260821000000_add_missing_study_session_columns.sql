-- Add columns that were missing from the base schema
ALTER TABLE study_sessions
  ADD COLUMN IF NOT EXISTS topic TEXT,
  ADD COLUMN IF NOT EXISTS topic_id TEXT REFERENCES topics (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS visual_table_json JSONB;

CREATE INDEX IF NOT EXISTS idx_study_sessions_topic_id ON study_sessions (topic_id);

-- Session collaboration members
CREATE TABLE IF NOT EXISTS session_members (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES study_sessions (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_session_members_session_id ON session_members (session_id);
CREATE INDEX IF NOT EXISTS idx_session_members_user_id ON session_members (user_id);
