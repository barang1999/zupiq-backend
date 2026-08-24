-- Add bookmarked column to study_sessions
ALTER TABLE study_sessions
  ADD COLUMN IF NOT EXISTS bookmarked BOOLEAN NOT NULL DEFAULT FALSE;
