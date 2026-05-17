-- ─────────────────────────────────────────────────────────────────────────────
-- Knowledge Records — User-saved AI-generated knowledge store
-- Run in Supabase SQL Editor: Dashboard → SQL Editor → New Query → paste → Run
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_records (
  id            TEXT        PRIMARY KEY,
  user_id       TEXT        NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- Human-readable title (node label, insight title, etc.)
  title         TEXT        NOT NULL,

  -- What kind of content is stored
  content_type  TEXT        NOT NULL CHECK (
    content_type IN ('insight', 'visual_table', 'conversation_message', 'node_breakdown')
  ),

  -- Optional context
  subject       TEXT,
  node_label    TEXT,

  -- The full saved payload as JSONB:
  --   insight:               { simpleBreakdown, keyFormula }
  --   visual_table:          VisualTableData (sign_analysis | generic)
  --   conversation_message:  { question, answer }
  --   node_breakdown:        { label, description, mathContent }
  content       JSONB       NOT NULL DEFAULT '{}',

  -- Plain-text digest used when building AI context (≤ 500 chars)
  summary       TEXT,

  tags          TEXT[]      NOT NULL DEFAULT '{}',

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_knowledge_records_user_id
  ON knowledge_records (user_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_records_user_subject
  ON knowledge_records (user_id, subject);

CREATE INDEX IF NOT EXISTS idx_knowledge_records_user_created
  ON knowledge_records (user_id, created_at DESC);

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE knowledge_records ENABLE ROW LEVEL SECURITY;

-- Users can only access their own records (backend uses service-role key which
-- bypasses RLS, but this protects against accidental direct DB access)
CREATE POLICY IF NOT EXISTS knowledge_records_owner
  ON knowledge_records
  FOR ALL
  USING (user_id = auth.uid()::text);
