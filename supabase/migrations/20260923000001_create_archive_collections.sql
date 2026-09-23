CREATE TABLE IF NOT EXISTS public.archive_collections (
  id          TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 50),
  color       TEXT        NOT NULL DEFAULT '#2563FF',
  is_system   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_collections_user_name
  ON public.archive_collections (user_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS idx_archive_collections_user_created
  ON public.archive_collections (user_id, created_at DESC);
