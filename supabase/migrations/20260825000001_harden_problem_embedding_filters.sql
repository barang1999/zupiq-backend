-- Keep semantic-cache filters consistent with resolver lookup behavior.
-- Older rows may have mixed-case language/subject values; resolver lookups are
-- case-insensitive, so expression indexes avoid slow filtered scans.

ALTER TABLE problem_embeddings
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en';

UPDATE problem_embeddings
SET language = LOWER(COALESCE(NULLIF(TRIM(language), ''), 'en'))
WHERE language IS DISTINCT FROM LOWER(COALESCE(NULLIF(TRIM(language), ''), 'en'));

CREATE INDEX IF NOT EXISTS idx_problem_embeddings_subject_lower
  ON problem_embeddings (LOWER(subject));

CREATE INDEX IF NOT EXISTS idx_problem_embeddings_language_lower
  ON problem_embeddings (LOWER(language));

ANALYZE problem_embeddings;
