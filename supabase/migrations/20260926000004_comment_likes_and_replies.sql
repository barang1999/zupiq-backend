-- Add like_count and reply_count to post_comments (public schema)
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS reply_count INTEGER NOT NULL DEFAULT 0;

-- comment_likes table
CREATE TABLE IF NOT EXISTS comment_likes (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id TEXT NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, comment_id)
);

-- Triggers for like_count
CREATE OR REPLACE FUNCTION increment_comment_like_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE post_comments SET like_count = like_count + 1 WHERE id = NEW.comment_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_comment_like_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE post_comments SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.comment_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comment_like_inc ON comment_likes;
CREATE TRIGGER trg_comment_like_inc AFTER INSERT ON comment_likes FOR EACH ROW EXECUTE FUNCTION increment_comment_like_count();
DROP TRIGGER IF EXISTS trg_comment_like_dec ON comment_likes;
CREATE TRIGGER trg_comment_like_dec AFTER DELETE ON comment_likes FOR EACH ROW EXECUTE FUNCTION decrement_comment_like_count();

-- Triggers for reply_count
CREATE OR REPLACE FUNCTION increment_comment_reply_count()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    UPDATE post_comments SET reply_count = reply_count + 1 WHERE id = NEW.parent_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_comment_reply_count()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.parent_id IS NOT NULL THEN
    UPDATE post_comments SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = OLD.parent_id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comment_reply_inc ON post_comments;
CREATE TRIGGER trg_comment_reply_inc AFTER INSERT ON post_comments FOR EACH ROW EXECUTE FUNCTION increment_comment_reply_count();
DROP TRIGGER IF EXISTS trg_comment_reply_dec ON post_comments;
CREATE TRIGGER trg_comment_reply_dec AFTER DELETE ON post_comments FOR EACH ROW EXECUTE FUNCTION decrement_comment_reply_count();
