-- Standalone resources (PDFs, notes, links) shared by users.
-- Always linked to a post via post_id for feed rendering.
CREATE TABLE IF NOT EXISTS resources (
  id              TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         TEXT        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  post_id         TEXT                 REFERENCES posts(id)   ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  description     TEXT,
  file_url        TEXT,
  file_type       TEXT        CHECK (file_type IN ('pdf','image','link','doc')),
  tags            TEXT[]      NOT NULL DEFAULT '{}',
  topic           TEXT,
  grade           TEXT,
  download_count  INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resources_user_id    ON resources (user_id);
CREATE INDEX IF NOT EXISTS idx_resources_topic      ON resources (topic);
CREATE INDEX IF NOT EXISTS idx_resources_created_at ON resources (created_at DESC);
