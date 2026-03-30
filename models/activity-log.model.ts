// ─── Activity action types ────────────────────────────────────────────────────

export type ActivityAction =
  | 'session_created'
  | 'session_updated'
  | 'deep_dive_message'
  | 'invitation_created'
  | 'member_joined'
  | 'member_left'
  | 'member_removed';

// ─── Metadata shapes per action ───────────────────────────────────────────────

export interface ActivityMetadata {
  // session_created
  title?: string;
  subject?: string;
  // session_updated
  fields?: string[];
  // deep_dive_message
  preview?: string;
  // invitation_created / member_joined
  role?: string;
  // member_removed
  removed_by?: string;
  removed_by_name?: string;
  // member_joined
  invited_by?: string;
  // generic
  [key: string]: unknown;
}

// ─── Core record ─────────────────────────────────────────────────────────────

export interface ActivityLogEntry {
  id: string;
  session_id: string;
  user_id: string | null;
  action: ActivityAction;
  metadata: ActivityMetadata;
  created_at: string;
  // Joined field — populated by getSessionActivity
  actor_name?: string;
  actor_avatar?: string | null;
}

// ─── DB Schema SQL (Supabase / PostgreSQL) ────────────────────────────────────
//
// Run in Supabase SQL Editor:
//
// CREATE TABLE IF NOT EXISTS session_activity_log (
//   id          TEXT PRIMARY KEY,
//   session_id  TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
//   user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
//   action      TEXT NOT NULL,
//   metadata    JSONB NOT NULL DEFAULT '{}',
//   created_at  TIMESTAMPTZ DEFAULT NOW()
// );
//
// CREATE INDEX IF NOT EXISTS idx_activity_log_session
//   ON session_activity_log (session_id, created_at DESC);
