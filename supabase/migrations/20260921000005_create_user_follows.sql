-- Directed follow graph. follower_id follows following_id.
CREATE TABLE IF NOT EXISTS user_follows (
  follower_id  TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE INDEX IF NOT EXISTS idx_user_follows_follower_id  ON user_follows (follower_id);
CREATE INDEX IF NOT EXISTS idx_user_follows_following_id ON user_follows (following_id);
