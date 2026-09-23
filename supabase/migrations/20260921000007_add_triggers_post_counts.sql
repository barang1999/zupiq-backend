-- Triggers to keep posts.like_count, comment_count, save_count in sync.

CREATE OR REPLACE FUNCTION increment_post_like_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_post_like_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_post_likes_insert
AFTER INSERT ON post_likes
FOR EACH ROW EXECUTE FUNCTION increment_post_like_count();

CREATE OR REPLACE TRIGGER trg_post_likes_delete
AFTER DELETE ON post_likes
FOR EACH ROW EXECUTE FUNCTION decrement_post_like_count();

-- comment_count
CREATE OR REPLACE FUNCTION increment_post_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_post_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_post_comments_insert
AFTER INSERT ON post_comments
FOR EACH ROW EXECUTE FUNCTION increment_post_comment_count();

CREATE OR REPLACE TRIGGER trg_post_comments_delete
AFTER DELETE ON post_comments
FOR EACH ROW EXECUTE FUNCTION decrement_post_comment_count();

-- save_count
CREATE OR REPLACE FUNCTION increment_post_save_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts SET save_count = save_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_post_save_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts SET save_count = GREATEST(save_count - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_post_saves_insert
AFTER INSERT ON post_saves
FOR EACH ROW EXECUTE FUNCTION increment_post_save_count();

CREATE OR REPLACE TRIGGER trg_post_saves_delete
AFTER DELETE ON post_saves
FOR EACH ROW EXECUTE FUNCTION decrement_post_save_count();
