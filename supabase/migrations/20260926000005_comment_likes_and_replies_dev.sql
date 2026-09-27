-- Add like_count and reply_count to dev.post_comments
ALTER TABLE dev.post_comments ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dev.post_comments ADD COLUMN IF NOT EXISTS reply_count INTEGER NOT NULL DEFAULT 0;

-- dev.comment_likes table
CREATE TABLE IF NOT EXISTS dev.comment_likes (
  user_id    TEXT NOT NULL REFERENCES dev.users(id) ON DELETE CASCADE,
  comment_id TEXT NOT NULL REFERENCES dev.post_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, comment_id)
);

-- Triggers for like_count (dev schema)
CREATE OR REPLACE FUNCTION dev.increment_comment_like_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE dev.post_comments SET like_count = like_count + 1 WHERE id = NEW.comment_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION dev.decrement_comment_like_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE dev.post_comments SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.comment_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comment_like_inc ON dev.comment_likes;
CREATE TRIGGER trg_comment_like_inc AFTER INSERT ON dev.comment_likes FOR EACH ROW EXECUTE FUNCTION dev.increment_comment_like_count();
DROP TRIGGER IF EXISTS trg_comment_like_dec ON dev.comment_likes;
CREATE TRIGGER trg_comment_like_dec AFTER DELETE ON dev.comment_likes FOR EACH ROW EXECUTE FUNCTION dev.decrement_comment_like_count();

-- Triggers for reply_count (dev schema)
CREATE OR REPLACE FUNCTION dev.increment_comment_reply_count()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    UPDATE dev.post_comments SET reply_count = reply_count + 1 WHERE id = NEW.parent_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION dev.decrement_comment_reply_count()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.parent_id IS NOT NULL THEN
    UPDATE dev.post_comments SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = OLD.parent_id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comment_reply_inc ON dev.post_comments;
CREATE TRIGGER trg_comment_reply_inc AFTER INSERT ON dev.post_comments FOR EACH ROW EXECUTE FUNCTION dev.increment_comment_reply_count();
DROP TRIGGER IF EXISTS trg_comment_reply_dec ON dev.post_comments;
CREATE TRIGGER trg_comment_reply_dec AFTER DELETE ON dev.post_comments FOR EACH ROW EXECUTE FUNCTION dev.decrement_comment_reply_count();
