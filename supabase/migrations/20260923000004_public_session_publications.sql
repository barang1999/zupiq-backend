-- Public, read-only session publication records and audit state.

BEGIN;

ALTER TABLE public.study_sessions
  ADD COLUMN IF NOT EXISTS is_publicly_shared BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS shared_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.session_publications (
  id          TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  session_id  TEXT        NOT NULL REFERENCES public.study_sessions(id) ON DELETE CASCADE,
  shared_by   TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_type TEXT        NOT NULL CHECK (source_type IN ('post', 'collection')),
  source_id   TEXT        NOT NULL,
  shared_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ,
  UNIQUE (session_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_session_publications_active
  ON public.session_publications (session_id, shared_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE public.session_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.session_publications FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_post_session_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.session_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.type <> 'solution' THEN
    RAISE EXCEPTION 'session_id is only valid for solution posts';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.study_sessions study_session
    WHERE study_session.id = NEW.session_id
      AND study_session.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'a user may only publish a session they own';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_posts_validate_session_owner_insert ON public.posts;
DROP TRIGGER IF EXISTS trg_posts_validate_session_owner_update ON public.posts;
CREATE TRIGGER trg_posts_validate_session_owner_insert
BEFORE INSERT ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.validate_post_session_ownership();
CREATE TRIGGER trg_posts_validate_session_owner_update
BEFORE UPDATE OF session_id, user_id, type ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.validate_post_session_ownership();

CREATE OR REPLACE FUNCTION public.refresh_session_public_share_state(target_session_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  latest_share RECORD;
BEGIN
  SELECT shared_by, shared_at
  INTO latest_share
  FROM public.session_publications
  WHERE session_id = target_session_id
    AND revoked_at IS NULL
  ORDER BY shared_at DESC
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.study_sessions
    SET is_publicly_shared = TRUE,
        shared_by = latest_share.shared_by,
        shared_at = latest_share.shared_at
    WHERE id = target_session_id;
  ELSE
    UPDATE public.study_sessions
    SET is_publicly_shared = FALSE,
        shared_by = NULL,
        shared_at = NULL
    WHERE id = target_session_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_session_publication_summary()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_session_public_share_state(OLD.session_id);
    RETURN OLD;
  END IF;

  PERFORM public.refresh_session_public_share_state(NEW.session_id);
  IF TG_OP = 'UPDATE' AND OLD.session_id IS DISTINCT FROM NEW.session_id THEN
    PERFORM public.refresh_session_public_share_state(OLD.session_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_session_publication_summary ON public.session_publications;
CREATE TRIGGER trg_session_publication_summary
AFTER INSERT OR UPDATE OR DELETE ON public.session_publications
FOR EACH ROW EXECUTE FUNCTION public.sync_session_publication_summary();

CREATE OR REPLACE FUNCTION public.sync_post_session_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.session_id IS NOT NULL THEN
    UPDATE public.session_publications
    SET revoked_at = NOW()
    WHERE session_id = OLD.session_id
      AND source_type = 'post'
      AND source_id = OLD.id
      AND revoked_at IS NULL;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE')
     AND NEW.session_id IS NOT NULL
     AND NEW.visibility = 'public' THEN
    INSERT INTO public.session_publications (session_id, shared_by, source_type, source_id, shared_at, revoked_at)
    VALUES (NEW.session_id, NEW.user_id, 'post', NEW.id, NEW.created_at, NULL)
    ON CONFLICT (session_id, source_type, source_id)
    DO UPDATE SET shared_by = EXCLUDED.shared_by, shared_at = EXCLUDED.shared_at, revoked_at = NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_posts_session_publication ON public.posts;
DROP TRIGGER IF EXISTS trg_posts_session_publication_update ON public.posts;
CREATE TRIGGER trg_posts_session_publication
AFTER INSERT OR DELETE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.sync_post_session_publication();
CREATE TRIGGER trg_posts_session_publication_update
AFTER UPDATE OF session_id, visibility ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.sync_post_session_publication();

CREATE OR REPLACE FUNCTION public.sync_post_collection_visibility()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_collection_id TEXT;
BEGIN
  old_collection_id := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.collection_id ELSE NULL END;

  IF old_collection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.posts
    WHERE collection_id = old_collection_id
      AND type = 'collection'
      AND visibility = 'public'
  ) THEN
    UPDATE public.archive_collections
    SET visibility = 'private'
    WHERE id = old_collection_id;
  END IF;

  IF TG_OP <> 'DELETE'
     AND NEW.collection_id IS NOT NULL
     AND NEW.type = 'collection'
     AND NEW.visibility = 'public' THEN
    UPDATE public.archive_collections
    SET visibility = 'public'
    WHERE id = NEW.collection_id
      AND user_id = NEW.user_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_posts_collection_visibility ON public.posts;
DROP TRIGGER IF EXISTS trg_posts_collection_visibility_update ON public.posts;
CREATE TRIGGER trg_posts_collection_visibility
AFTER INSERT OR DELETE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.sync_post_collection_visibility();
CREATE TRIGGER trg_posts_collection_visibility_update
AFTER UPDATE OF collection_id, type, visibility ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.sync_post_collection_visibility();

CREATE OR REPLACE FUNCTION public.publish_collection_sessions(target_collection_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.session_publications (session_id, shared_by, source_type, source_id, shared_at, revoked_at)
  SELECT ai.source_id, c.user_id, 'collection', c.id, COALESCE(aci.added_at, NOW()), NULL
  FROM public.archive_collections c
  JOIN public.archive_collection_items aci ON aci.collection_id = c.id
  JOIN public.archive_items ai ON ai.id = aci.archive_item_id
  JOIN public.study_sessions study_session
    ON study_session.id = ai.source_id
   AND study_session.user_id = c.user_id
  WHERE c.id = target_collection_id
    AND c.visibility = 'public'
    AND ai.type = 'solution'
    AND ai.source_type = 'study_session'
    AND ai.source_id IS NOT NULL
  ON CONFLICT (session_id, source_type, source_id)
  DO UPDATE SET shared_by = EXCLUDED.shared_by, shared_at = EXCLUDED.shared_at, revoked_at = NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_collection_visibility_publications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.visibility = 'public' AND NEW.visibility <> 'public') THEN
    UPDATE public.session_publications
    SET revoked_at = NOW()
    WHERE source_type = 'collection'
      AND source_id = OLD.id
      AND revoked_at IS NULL;
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.visibility = 'public' THEN
    PERFORM public.publish_collection_sessions(NEW.id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_collection_visibility_publications ON public.archive_collections;
DROP TRIGGER IF EXISTS trg_collection_visibility_publications_update ON public.archive_collections;
CREATE TRIGGER trg_collection_visibility_publications
AFTER INSERT OR DELETE ON public.archive_collections
FOR EACH ROW EXECUTE FUNCTION public.sync_collection_visibility_publications();
CREATE TRIGGER trg_collection_visibility_publications_update
AFTER UPDATE OF visibility ON public.archive_collections
FOR EACH ROW EXECUTE FUNCTION public.sync_collection_visibility_publications();

CREATE OR REPLACE FUNCTION public.sync_collection_item_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_item RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT source_id INTO target_item
    FROM public.archive_items
    WHERE id = OLD.archive_item_id
      AND type = 'solution'
      AND source_type = 'study_session';

    IF target_item.source_id IS NOT NULL THEN
      UPDATE public.session_publications
      SET revoked_at = NOW()
      WHERE session_id = target_item.source_id
        AND source_type = 'collection'
        AND source_id = OLD.collection_id
        AND revoked_at IS NULL;
    END IF;
    RETURN OLD;
  END IF;

  PERFORM public.publish_collection_sessions(NEW.collection_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_collection_item_publication ON public.archive_collection_items;
CREATE TRIGGER trg_collection_item_publication
AFTER INSERT OR DELETE ON public.archive_collection_items
FOR EACH ROW EXECUTE FUNCTION public.sync_collection_item_publication();

CREATE OR REPLACE FUNCTION public.revoke_deleted_archive_solution_publications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.type = 'solution' AND OLD.source_type = 'study_session' AND OLD.source_id IS NOT NULL THEN
    UPDATE public.session_publications publication
    SET revoked_at = NOW()
    WHERE publication.session_id = OLD.source_id
      AND publication.source_type = 'collection'
      AND publication.revoked_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.archive_collection_items membership
        WHERE membership.archive_item_id = OLD.id
          AND membership.collection_id = publication.source_id
      );
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_archive_solution_publication_delete ON public.archive_items;
CREATE TRIGGER trg_archive_solution_publication_delete
BEFORE DELETE ON public.archive_items
FOR EACH ROW EXECUTE FUNCTION public.revoke_deleted_archive_solution_publications();

-- Backfill active direct-post and public-collection publications.
INSERT INTO public.session_publications (session_id, shared_by, source_type, source_id, shared_at)
SELECT post.session_id, post.user_id, 'post', post.id, post.created_at
FROM public.posts post
JOIN public.study_sessions study_session
  ON study_session.id = post.session_id
 AND study_session.user_id = post.user_id
WHERE post.session_id IS NOT NULL AND post.visibility = 'public'
ON CONFLICT (session_id, source_type, source_id) DO UPDATE
SET shared_by = EXCLUDED.shared_by, shared_at = EXCLUDED.shared_at, revoked_at = NULL;

DO $$
DECLARE
  collection_row RECORD;
BEGIN
  FOR collection_row IN SELECT id FROM public.archive_collections WHERE visibility = 'public' LOOP
    PERFORM public.publish_collection_sessions(collection_row.id);
  END LOOP;
END;
$$;

-- These functions exist for internal trigger execution only. Public API roles
-- must not be able to invoke the SECURITY DEFINER helpers through RPC.
REVOKE EXECUTE ON FUNCTION public.validate_post_session_ownership() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_session_public_share_state(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_session_publication_summary() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_post_session_publication() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_post_collection_visibility() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.publish_collection_sessions(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_collection_visibility_publications() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_collection_item_publication() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_deleted_archive_solution_publications() FROM PUBLIC, anon, authenticated;

COMMIT;
