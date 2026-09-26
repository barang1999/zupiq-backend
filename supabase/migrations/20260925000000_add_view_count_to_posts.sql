-- Add view_count to posts table
ALTER TABLE posts ADD COLUMN IF NOT EXISTS view_count INT NOT NULL DEFAULT 0;

-- Trigger function: increment view_count only when a brand-new 'view' row is
-- inserted into user_post_interactions. Because logInteraction uses upsert
-- (INSERT ... ON CONFLICT DO UPDATE), duplicate views result in an UPDATE, not
-- an INSERT, so this trigger never double-counts the same viewer.
CREATE OR REPLACE FUNCTION increment_post_view_count()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.event_type = 'view' THEN
    UPDATE posts SET view_count = view_count + 1 WHERE id = NEW.post_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_increment_post_view_count ON user_post_interactions;
CREATE TRIGGER trg_increment_post_view_count
AFTER INSERT ON user_post_interactions
FOR EACH ROW EXECUTE FUNCTION increment_post_view_count();
