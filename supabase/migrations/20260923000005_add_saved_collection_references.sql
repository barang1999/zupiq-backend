-- Save public collections as top-level, read-only Archive references.

BEGIN;

CREATE TABLE IF NOT EXISTS public.archive_saved_collections (
  user_id              TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_collection_id TEXT        NOT NULL REFERENCES public.archive_collections(id) ON DELETE CASCADE,
  saved_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, source_collection_id)
);

CREATE INDEX IF NOT EXISTS idx_archive_saved_collections_user_saved
  ON public.archive_saved_collections (user_id, saved_at DESC);

ALTER TABLE public.archive_saved_collections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.archive_saved_collections FROM PUBLIC, anon, authenticated;

COMMIT;
