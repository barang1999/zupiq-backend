-- Allow users to publish an owned Archive collection as a community post.

BEGIN;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS collection_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'posts_collection_id_fkey'
      AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_collection_id_fkey
      FOREIGN KEY (collection_id)
      REFERENCES public.archive_collections(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_type_check;
ALTER TABLE public.posts ADD CONSTRAINT posts_type_check
  CHECK (type IN ('solution', 'question', 'resource', 'photo', 'document', 'collection'));

CREATE INDEX IF NOT EXISTS idx_posts_collection_id
  ON public.posts (collection_id)
  WHERE collection_id IS NOT NULL;

COMMIT;
