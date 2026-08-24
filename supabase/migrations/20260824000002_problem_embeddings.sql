-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Stores embeddings of positively-rated problem solutions for semantic retrieval.
CREATE TABLE IF NOT EXISTS problem_embeddings (
  id             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  session_id     TEXT        NOT NULL UNIQUE REFERENCES study_sessions(id) ON DELETE CASCADE,
  user_id        TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject        TEXT,
  topic          TEXT,
  problem_text   TEXT        NOT NULL,
  embedding      vector(768),
  final_answer   TEXT,
  solution_text  TEXT,
  breakdown_json JSONB,
  feedback_count INTEGER     NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_problem_embeddings_subject
  ON problem_embeddings (subject);

-- IVFFlat index for fast approximate nearest-neighbor search.
-- lists=100 is appropriate for up to ~1M rows; tune upward as data grows.
CREATE INDEX IF NOT EXISTS idx_problem_embeddings_embedding
  ON problem_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
