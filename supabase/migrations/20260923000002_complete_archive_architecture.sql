-- Complete Archive architecture. Archive is private, backend-owned storage.
-- Mobile clients use /api/archive; the service-role client is the only database caller.

BEGIN;

CREATE TABLE IF NOT EXISTS public.archive_collections (
  id          TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 50),
  description TEXT,
  icon        TEXT,
  color       TEXT        NOT NULL DEFAULT '#2563FF',
  visibility  TEXT        NOT NULL DEFAULT 'private',
  is_system   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, user_id)
);

-- Upgrade environments where the earlier collection-only migration already ran.
ALTER TABLE public.archive_collections
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS icon TEXT,
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'archive_collections_description_length'
      AND conrelid = 'public.archive_collections'::regclass
  ) THEN
    ALTER TABLE public.archive_collections
      ADD CONSTRAINT archive_collections_description_length
      CHECK (description IS NULL OR char_length(description) <= 280);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'archive_collections_visibility_valid'
      AND conrelid = 'public.archive_collections'::regclass
  ) THEN
    ALTER TABLE public.archive_collections
      ADD CONSTRAINT archive_collections_visibility_valid
      CHECK (visibility IN ('private', 'unlisted', 'public'));
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_collections_id_user
  ON public.archive_collections (id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_collections_user_name
  ON public.archive_collections (user_id, lower(btrim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_collections_saved_system
  ON public.archive_collections (user_id) WHERE is_system;
CREATE INDEX IF NOT EXISTS idx_archive_collections_user_created
  ON public.archive_collections (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.archive_items (
  id             TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id        TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type           TEXT        NOT NULL CHECK (type IN ('solution', 'post', 'image', 'board', 'note')),
  source_type    TEXT,
  source_id      TEXT,
  title          TEXT        NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  preview        TEXT,
  asset_url      TEXT,
  metadata       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  source_snapshot JSONB,
  last_saved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_viewed_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((source_type IS NULL) = (source_id IS NULL)),
  UNIQUE (id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_items_source
  ON public.archive_items (user_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_archive_items_user_recent
  ON public.archive_items (user_id, last_saved_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_archive_items_user_type
  ON public.archive_items (user_id, type, last_saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_archive_items_search
  ON public.archive_items USING gin (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(preview, ''))
  );

CREATE TABLE IF NOT EXISTS public.archive_collection_items (
  user_id         TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  collection_id   TEXT        NOT NULL,
  archive_item_id TEXT        NOT NULL,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (collection_id, archive_item_id),
  FOREIGN KEY (collection_id, user_id)
    REFERENCES public.archive_collections(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (archive_item_id, user_id)
    REFERENCES public.archive_items(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_collection_items_user
  ON public.archive_collection_items (user_id, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_archive_collection_items_item
  ON public.archive_collection_items (archive_item_id);

CREATE TABLE IF NOT EXISTS public.archive_item_notes (
  id              TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  archive_item_id TEXT        NOT NULL,
  content         TEXT        NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 5000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (archive_item_id),
  FOREIGN KEY (archive_item_id, user_id)
    REFERENCES public.archive_items(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_archive_item_notes_user
  ON public.archive_item_notes (user_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.archive_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_touch_item_saved_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.archive_items
  SET last_saved_at = NOW(), updated_at = NOW()
  WHERE id = NEW.archive_item_id AND user_id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_archive_collections_updated_at ON public.archive_collections;
CREATE TRIGGER trg_archive_collections_updated_at BEFORE UPDATE ON public.archive_collections
FOR EACH ROW EXECUTE FUNCTION public.archive_touch_updated_at();

DROP TRIGGER IF EXISTS trg_archive_items_updated_at ON public.archive_items;
CREATE TRIGGER trg_archive_items_updated_at BEFORE UPDATE ON public.archive_items
FOR EACH ROW EXECUTE FUNCTION public.archive_touch_updated_at();

DROP TRIGGER IF EXISTS trg_archive_item_notes_updated_at ON public.archive_item_notes;
CREATE TRIGGER trg_archive_item_notes_updated_at BEFORE UPDATE ON public.archive_item_notes
FOR EACH ROW EXECUTE FUNCTION public.archive_touch_updated_at();

DROP TRIGGER IF EXISTS trg_archive_collection_item_saved_at ON public.archive_collection_items;
CREATE TRIGGER trg_archive_collection_item_saved_at AFTER INSERT ON public.archive_collection_items
FOR EACH ROW EXECUTE FUNCTION public.archive_touch_item_saved_at();

-- Every account owns exactly one non-deletable system Saved collection.
CREATE OR REPLACE FUNCTION public.ensure_archive_saved_collection(target_user_id TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE saved_id TEXT;
BEGIN
  SELECT id INTO saved_id
  FROM public.archive_collections
  WHERE user_id = target_user_id AND is_system = TRUE
  LIMIT 1;
  IF saved_id IS NOT NULL THEN
    RETURN saved_id;
  END IF;

  -- Early collection-only builds allowed a custom collection named Saved.
  -- Promote it rather than failing the case-insensitive name constraint.
  UPDATE public.archive_collections
  SET is_system = TRUE, name = 'Saved'
  WHERE id = (
    SELECT id FROM public.archive_collections
    WHERE user_id = target_user_id AND lower(btrim(name)) = 'saved'
    ORDER BY created_at ASC
    LIMIT 1
  )
  RETURNING id INTO saved_id;
  IF saved_id IS NOT NULL THEN
    RETURN saved_id;
  END IF;

  INSERT INTO public.archive_collections (user_id, name, color, is_system)
  VALUES (target_user_id, 'Saved', '#2563FF', TRUE)
  ON CONFLICT (user_id) WHERE is_system DO UPDATE SET name = 'Saved'
  RETURNING id INTO saved_id;
  RETURN saved_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_archive_saved_collection_for_user()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.ensure_archive_saved_collection(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_archive_saved_collection ON public.users;
CREATE TRIGGER trg_create_archive_saved_collection AFTER INSERT ON public.users
FOR EACH ROW EXECUTE FUNCTION public.create_archive_saved_collection_for_user();

SELECT public.ensure_archive_saved_collection(id) FROM public.users;

-- Preserve existing bookmark data while migrating to the unified model.
INSERT INTO public.archive_items (
  user_id, type, source_type, source_id, title, preview, asset_url, metadata, source_snapshot,
  last_saved_at, created_at
)
SELECT
  ps.user_id, 'post', 'post', p.id,
  coalesce(nullif(btrim(p.caption), ''), nullif(btrim(p.topic), ''), nullif(btrim(p.file_name), ''), 'Saved post'),
  coalesce(p.caption, p.image_ocr_text, p.topic), coalesce(p.image_url, p.file_url),
  jsonb_strip_nulls(jsonb_build_object('postType', p.type, 'topic', p.topic, 'fileName', p.file_name)), NULL,
  ps.created_at, ps.created_at
FROM public.post_saves ps
JOIN public.posts p ON p.id = ps.post_id
ON CONFLICT (user_id, source_type, source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL
DO NOTHING;

INSERT INTO public.archive_items (
  user_id, type, source_type, source_id, title, preview, asset_url, metadata, source_snapshot,
  last_saved_at, created_at
)
SELECT
  s.user_id, 'solution', 'study_session', s.id,
  coalesce(nullif(btrim(s.title), ''), 'Saved solution'), s.problem, s.image_url,
  jsonb_strip_nulls(jsonb_build_object('subjectId', s.subject_id, 'topicId', s.topic_id)),
  jsonb_build_object('breakdown', s.breakdown_json, 'visualTable', s.visual_table_json, 'createdAt', s.created_at),
  s.created_at, s.created_at
FROM public.study_sessions s
WHERE s.bookmarked = TRUE
ON CONFLICT (user_id, source_type, source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL
DO NOTHING;

INSERT INTO public.archive_collection_items (user_id, collection_id, archive_item_id, added_at)
SELECT i.user_id, c.id, i.id, i.last_saved_at
FROM public.archive_items i
JOIN public.archive_collections c ON c.user_id = i.user_id AND c.is_system = TRUE
ON CONFLICT (collection_id, archive_item_id) DO NOTHING;

-- Keep existing bookmark endpoints as the single UI action while Archive
-- becomes the canonical organization layer underneath them.
CREATE OR REPLACE FUNCTION public.archive_post_save_inserted()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE saved_id TEXT;
DECLARE item_id TEXT;
BEGIN
  saved_id := public.ensure_archive_saved_collection(NEW.user_id);
  INSERT INTO public.archive_items (
    user_id, type, source_type, source_id, title, preview, asset_url, metadata, source_snapshot,
    last_saved_at, created_at
  )
  SELECT
    NEW.user_id, 'post', 'post', p.id,
    coalesce(nullif(btrim(p.caption), ''), nullif(btrim(p.topic), ''), nullif(btrim(p.file_name), ''), 'Saved post'),
    coalesce(p.caption, p.image_ocr_text, p.topic), coalesce(p.image_url, p.file_url),
    jsonb_strip_nulls(jsonb_build_object('postType', p.type, 'topic', p.topic, 'fileName', p.file_name)), NULL,
    NEW.created_at, NEW.created_at
  FROM public.posts p WHERE p.id = NEW.post_id
  ON CONFLICT (user_id, source_type, source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL
  DO UPDATE SET
    title = EXCLUDED.title,
    preview = EXCLUDED.preview,
    asset_url = EXCLUDED.asset_url,
    metadata = EXCLUDED.metadata,
    source_snapshot = EXCLUDED.source_snapshot,
    last_saved_at = EXCLUDED.last_saved_at
  RETURNING id INTO item_id;

  INSERT INTO public.archive_collection_items (user_id, collection_id, archive_item_id, added_at)
  VALUES (NEW.user_id, saved_id, item_id, NEW.created_at)
  ON CONFLICT (collection_id, archive_item_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_post_save_deleted()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE saved_id TEXT;
DECLARE item_id TEXT;
DECLARE source_unavailable BOOLEAN;
BEGIN
  SELECT id INTO saved_id FROM public.archive_collections
  WHERE user_id = OLD.user_id AND is_system = TRUE;
  SELECT id, coalesce((metadata->>'sourceUnavailable')::boolean, FALSE)
  INTO item_id, source_unavailable
  FROM public.archive_items
  WHERE user_id = OLD.user_id AND source_type = 'post' AND source_id = OLD.post_id;

  IF item_id IS NOT NULL THEN
    DELETE FROM public.archive_collection_items
    WHERE user_id = OLD.user_id AND collection_id = saved_id AND archive_item_id = item_id;
    IF NOT source_unavailable AND NOT EXISTS (
      SELECT 1 FROM public.archive_collection_items WHERE archive_item_id = item_id
    ) THEN
      DELETE FROM public.archive_items WHERE id = item_id AND user_id = OLD.user_id;
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_mark_post_unavailable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.archive_items
  SET metadata = metadata || jsonb_build_object('sourceUnavailable', TRUE)
  WHERE source_type IN ('post', 'post_image') AND source_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_session_bookmark_changed()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE saved_id TEXT;
DECLARE item_id TEXT;
BEGIN
  saved_id := public.ensure_archive_saved_collection(NEW.user_id);
  IF NEW.bookmarked = TRUE THEN
    INSERT INTO public.archive_items (
      user_id, type, source_type, source_id, title, preview, asset_url, metadata, source_snapshot,
      last_saved_at, created_at
    ) VALUES (
      NEW.user_id, 'solution', 'study_session', NEW.id,
      coalesce(nullif(btrim(NEW.title), ''), 'Saved solution'), NEW.problem, NEW.image_url,
      jsonb_strip_nulls(jsonb_build_object('subjectId', NEW.subject_id, 'topicId', NEW.topic_id)),
      jsonb_build_object('breakdown', NEW.breakdown_json, 'visualTable', NEW.visual_table_json, 'createdAt', NEW.created_at),
      NOW(), NEW.created_at
    )
    ON CONFLICT (user_id, source_type, source_id) WHERE source_type IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET
      title = EXCLUDED.title,
      preview = EXCLUDED.preview,
      asset_url = EXCLUDED.asset_url,
      metadata = EXCLUDED.metadata,
      source_snapshot = EXCLUDED.source_snapshot,
      last_saved_at = EXCLUDED.last_saved_at
    RETURNING id INTO item_id;

    INSERT INTO public.archive_collection_items (user_id, collection_id, archive_item_id)
    VALUES (NEW.user_id, saved_id, item_id)
    ON CONFLICT (collection_id, archive_item_id) DO NOTHING;
  ELSE
    SELECT id INTO item_id FROM public.archive_items
    WHERE user_id = NEW.user_id AND source_type = 'study_session' AND source_id = NEW.id;
    IF item_id IS NOT NULL THEN
      DELETE FROM public.archive_collection_items
      WHERE user_id = NEW.user_id AND collection_id = saved_id AND archive_item_id = item_id;
      IF NOT EXISTS (SELECT 1 FROM public.archive_collection_items WHERE archive_item_id = item_id) THEN
        DELETE FROM public.archive_items WHERE id = item_id AND user_id = NEW.user_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_mark_session_unavailable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.archive_items
  SET metadata = metadata || jsonb_build_object('sourceUnavailable', TRUE)
  WHERE source_type = 'study_session' AND source_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_archive_post_save_insert ON public.post_saves;
CREATE TRIGGER trg_archive_post_save_insert AFTER INSERT ON public.post_saves
FOR EACH ROW EXECUTE FUNCTION public.archive_post_save_inserted();

DROP TRIGGER IF EXISTS trg_archive_post_save_delete ON public.post_saves;
CREATE TRIGGER trg_archive_post_save_delete AFTER DELETE ON public.post_saves
FOR EACH ROW EXECUTE FUNCTION public.archive_post_save_deleted();

DROP TRIGGER IF EXISTS trg_archive_post_unavailable ON public.posts;
CREATE TRIGGER trg_archive_post_unavailable BEFORE DELETE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.archive_mark_post_unavailable();

DROP TRIGGER IF EXISTS trg_archive_session_bookmark_insert ON public.study_sessions;
CREATE TRIGGER trg_archive_session_bookmark_insert AFTER INSERT ON public.study_sessions
FOR EACH ROW WHEN (NEW.bookmarked = TRUE)
EXECUTE FUNCTION public.archive_session_bookmark_changed();

DROP TRIGGER IF EXISTS trg_archive_session_bookmark_update ON public.study_sessions;
CREATE TRIGGER trg_archive_session_bookmark_update AFTER UPDATE OF bookmarked ON public.study_sessions
FOR EACH ROW WHEN (OLD.bookmarked IS DISTINCT FROM NEW.bookmarked)
EXECUTE FUNCTION public.archive_session_bookmark_changed();

DROP TRIGGER IF EXISTS trg_archive_session_unavailable ON public.study_sessions;
CREATE TRIGGER trg_archive_session_unavailable BEFORE DELETE ON public.study_sessions
FOR EACH ROW EXECUTE FUNCTION public.archive_mark_session_unavailable();

-- RLS is deliberately policy-free: only the backend service role may access
-- these private tables. The service layer always scopes by the JWT user id.
ALTER TABLE public.archive_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_collection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_item_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.archive_collections FROM anon, authenticated;
REVOKE ALL ON TABLE public.archive_items FROM anon, authenticated;
REVOKE ALL ON TABLE public.archive_collection_items FROM anon, authenticated;
REVOKE ALL ON TABLE public.archive_item_notes FROM anon, authenticated;

COMMIT;
