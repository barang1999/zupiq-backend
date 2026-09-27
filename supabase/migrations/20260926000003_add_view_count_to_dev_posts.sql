-- Mirror of 20260925000000_add_view_count_to_posts.sql for the dev schema.

ALTER TABLE dev.posts ADD COLUMN IF NOT EXISTS view_count INT NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION dev.increment_post_view_count()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.event_type = 'view' THEN
    UPDATE dev.posts SET view_count = view_count + 1 WHERE id = NEW.post_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_increment_post_view_count ON dev.user_post_interactions;
CREATE TRIGGER trg_increment_post_view_count
AFTER INSERT ON dev.user_post_interactions
FOR EACH ROW EXECUTE FUNCTION dev.increment_post_view_count();
