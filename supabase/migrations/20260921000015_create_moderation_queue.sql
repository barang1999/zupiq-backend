-- Admin review queue for borderline content flagged by the moderation pipeline.
-- Only populated when Gemini classifier returns confidence 0.4–0.6 (uncertain).
-- Clear violations (confidence > 0.6) are blocked outright and never queued.

CREATE TABLE IF NOT EXISTS moderation_queue (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id    TEXT        NOT NULL,
  content_type  TEXT        NOT NULL CHECK (content_type IN ('post', 'comment')),
  content_text  TEXT        NOT NULL,
  layer         INTEGER     NOT NULL,     -- 1=keyword, 2=pattern, 3=ai
  category      TEXT,                     -- adult | hate_speech | harassment | violence | spam | off_topic
  confidence    FLOAT,
  reason        TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'removed')),
  reviewed_by   TEXT        REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_modq_status     ON moderation_queue (status);
CREATE INDEX IF NOT EXISTS idx_modq_created_at ON moderation_queue (created_at DESC);
