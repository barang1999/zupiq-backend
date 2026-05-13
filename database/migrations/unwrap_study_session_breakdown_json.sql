-- Converts legacy rows where study_sessions.breakdown_json was inserted as a
-- JSONB string containing JSON text into a proper JSONB object/array.
UPDATE study_sessions
SET breakdown_json = (breakdown_json #>> '{}')::jsonb
WHERE jsonb_typeof(breakdown_json) = 'string'
  AND left(trim(breakdown_json #>> '{}'), 1) IN ('{', '[');

