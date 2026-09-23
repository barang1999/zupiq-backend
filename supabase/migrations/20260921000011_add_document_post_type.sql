-- Add document post type and file columns
ALTER TABLE posts ADD COLUMN IF NOT EXISTS file_url  TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS file_name TEXT;

ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_type_check;
ALTER TABLE posts ADD CONSTRAINT posts_type_check
  CHECK (type IN ('solution', 'question', 'resource', 'photo', 'document'));
