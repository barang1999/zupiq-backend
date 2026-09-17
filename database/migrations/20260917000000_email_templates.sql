-- ─── Admin Email Templates ───────────────────────────────────────────────────
-- Stores reusable email templates created in the admin dashboard.

CREATE TABLE IF NOT EXISTS email_templates (
  id          TEXT        PRIMARY KEY,
  name        TEXT        NOT NULL,
  subject     TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_templates_created
  ON email_templates (created_at DESC);
