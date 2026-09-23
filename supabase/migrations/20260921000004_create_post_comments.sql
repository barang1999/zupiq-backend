CREATE TABLE IF NOT EXISTS post_comments (
  id          TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  post_id     TEXT        NOT NULL REFERENCES posts(id)          ON DELETE CASCADE,
  user_id     TEXT        NOT NULL REFERENCES users(id)          ON DELETE CASCADE,
  parent_id   TEXT                 REFERENCES post_comments(id)  ON DELETE CASCADE,
  content     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON post_comments (post_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_user_id ON post_comments (user_id);
