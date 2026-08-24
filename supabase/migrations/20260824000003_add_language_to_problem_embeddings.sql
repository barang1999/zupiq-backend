ALTER TABLE problem_embeddings
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en';

CREATE INDEX IF NOT EXISTS idx_problem_embeddings_language
  ON problem_embeddings (language);
