-- Ensure study_sessions.breakdown_json is stored as structured JSONB.
-- Existing JSON text rows are cast into jsonb; invalid legacy text falls back to '{}'.
CREATE OR REPLACE FUNCTION pg_temp.zupiq_try_jsonb(value text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN value::jsonb;
EXCEPTION WHEN others THEN
  RETURN '{}'::jsonb;
END;
$$;

ALTER TABLE study_sessions
ALTER COLUMN breakdown_json TYPE jsonb
USING pg_temp.zupiq_try_jsonb(breakdown_json::text);

ALTER TABLE study_sessions
ALTER COLUMN breakdown_json SET DEFAULT '{}'::jsonb,
ALTER COLUMN breakdown_json SET NOT NULL;
