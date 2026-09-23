-- Public posts: a shared study_session made visible to the community.
-- type: 'solution' | 'question' | 'resource'
-- visibility: 'public' | 'followers'
-- like_count / comment_count / save_count are denormalized and updated by triggers.
CREATE TABLE IF NOT EXISTS posts (
  id              TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         TEXT        NOT NULL REFERENCES users(id)           ON DELETE CASCADE,
  session_id      TEXT                 REFERENCES study_sessions(id)  ON DELETE SET NULL,
  type            TEXT        NOT NULL CHECK (type IN ('solution','question','resource')),
  visibility      TEXT        NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','followers')),
  topic           TEXT,
  grade           TEXT,
  verified        BOOLEAN     NOT NULL DEFAULT FALSE,
  like_count      INTEGER     NOT NULL DEFAULT 0,
  comment_count   INTEGER     NOT NULL DEFAULT 0,
  save_count      INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_user_id     ON posts (user_id);
CREATE INDEX IF NOT EXISTS idx_posts_topic       ON posts (topic);
CREATE INDEX IF NOT EXISTS idx_posts_visibility  ON posts (visibility);
CREATE INDEX IF NOT EXISTS idx_posts_created_at  ON posts (created_at DESC);
