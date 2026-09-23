-- Auto level detection: inferred education level from study session activity.
-- detected_level  — most probable level based on rolling vote aggregation
-- level_confidence — how confident the system is (0.0–1.0)
-- level_votes     — raw vote weights per level, e.g. {"high_school":0.72,"undergraduate":0.28}
--
-- Reputation scoring: derived from likes/saves/comments/followers received.
-- reputation_score — denormalized float, recomputed by background job

ALTER TABLE users ADD COLUMN IF NOT EXISTS detected_level    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS level_confidence  FLOAT   DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS level_votes       JSONB   DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS reputation_score  FLOAT   DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_detected_level   ON users (detected_level);
CREATE INDEX IF NOT EXISTS idx_users_reputation_score ON users (reputation_score DESC);
