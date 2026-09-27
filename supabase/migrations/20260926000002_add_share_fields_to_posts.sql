-- Add reshare support to posts
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS shared_from_post_id TEXT REFERENCES posts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS share_count         INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_posts_shared_from_post_id ON posts (shared_from_post_id);
