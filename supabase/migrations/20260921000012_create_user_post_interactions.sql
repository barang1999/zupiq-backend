-- Tracks per-user engagement events on posts (view, like, save, comment, share).
-- Used for personalized feed ranking and topic interest derivation.
-- Views are upserted (ON CONFLICT UPDATE) to avoid duplicate rows while still
-- refreshing created_at so recency of last view is always accurate.

CREATE TABLE IF NOT EXISTS user_post_interactions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  post_id      TEXT        NOT NULL REFERENCES posts(id)  ON DELETE CASCADE,
  event_type   TEXT        NOT NULL CHECK (event_type IN ('view','like','save','comment','share')),
  duration_ms  INTEGER,                        -- dwell time, only for 'view' events
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique per (user, post, event_type) so we upsert rather than multi-insert
CREATE UNIQUE INDEX IF NOT EXISTS uq_upi_user_post_event
  ON user_post_interactions (user_id, post_id, event_type);

CREATE INDEX IF NOT EXISTS idx_upi_user_id    ON user_post_interactions (user_id);
CREATE INDEX IF NOT EXISTS idx_upi_post_id    ON user_post_interactions (post_id);
CREATE INDEX IF NOT EXISTS idx_upi_created_at ON user_post_interactions (created_at DESC);
