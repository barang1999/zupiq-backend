-- Add caption and direct image_url for photo/freeform posts
-- (image_url on posts itself, separate from study_sessions.image_url)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS caption   TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Extend allowed post types to include 'photo'
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_type_check;
ALTER TABLE posts ADD CONSTRAINT posts_type_check
  CHECK (type IN ('solution', 'question', 'resource', 'photo'));
