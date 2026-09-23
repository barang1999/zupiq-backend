-- One row per (post_id, user_id). Compound PK enforces one like per user.
CREATE TABLE IF NOT EXISTS post_likes (
  post_id     TEXT        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_likes_user_id ON post_likes (user_id);
