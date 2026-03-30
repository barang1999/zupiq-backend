// ─── Types ────────────────────────────────────────────────────────────────────

export type MemberRole = 'owner' | 'editor' | 'viewer';

export interface SessionMember {
  id: string;
  session_id: string;
  user_id: string;
  role: MemberRole;
  invited_by: string | null;
  joined_at: string;
}

export interface SessionMemberWithUser extends SessionMember {
  full_name: string;
  email: string;
  avatar_url: string | null;
}

export interface SessionInvitation {
  id: string;
  session_id: string;
  invited_by: string;
  invite_token: string;
  invited_email: string | null;
  role: Exclude<MemberRole, 'owner'>;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

// ─── DB Schema SQL (Supabase / PostgreSQL) ────────────────────────────────────
//
// Run these in your Supabase SQL editor or migration tool.
//
// CREATE TABLE IF NOT EXISTS session_members (
//   id          TEXT PRIMARY KEY,
//   session_id  TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
//   user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//   role        TEXT NOT NULL DEFAULT 'editor'
//                 CHECK (role IN ('editor', 'viewer')),
//   invited_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
//   joined_at   TIMESTAMPTZ DEFAULT NOW(),
//   UNIQUE (session_id, user_id)
// );
//
// CREATE TABLE IF NOT EXISTS session_invitations (
//   id             TEXT PRIMARY KEY,
//   session_id     TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
//   invited_by     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//   invite_token   TEXT NOT NULL UNIQUE,
//   invited_email  TEXT,
//   role           TEXT NOT NULL DEFAULT 'editor'
//                    CHECK (role IN ('editor', 'viewer')),
//   expires_at     TIMESTAMPTZ NOT NULL,
//   accepted_at    TIMESTAMPTZ,
//   created_at     TIMESTAMPTZ DEFAULT NOW()
// );
//
// -- Index for fast token lookups
// CREATE INDEX IF NOT EXISTS idx_session_invitations_token
//   ON session_invitations (invite_token);
//
// -- Index for fast member lookups per session
// CREATE INDEX IF NOT EXISTS idx_session_members_session
//   ON session_members (session_id);
