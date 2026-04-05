// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface StudySession {
  id: string;
  user_id: string;
  title: string;
  subject: string;
  subject_id: string | null;
  problem: string;
  node_count: number;
  duration_seconds: number | null;
  breakdown_json: string; // serialized ProblemBreakdown (nodes include mathContent + keyFormula)
  visual_table_json?: string | null;
  created_at: string;
  /** Populated by getUserSessions — caller's access level for this session. */
  user_role?: 'owner' | 'editor' | 'viewer';
}

export interface CreateSessionDTO {
  title: string;
  subject: string;
  subject_id?: string | null;
  problem: string;
  node_count: number;
  duration_seconds?: number;
  breakdown_json: string;
  visual_table_json?: string | null;
}

export interface UpdateSessionDTO {
  title?: string;
  subject?: string;
  subject_id?: string | null;
  problem?: string;
  node_count?: number;
  duration_seconds?: number;
  breakdown_json?: string;
  visual_table_json?: string | null;
}

// ─── DB Schema SQL ────────────────────────────────────────────────────────────

export const STUDY_SESSIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS study_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT 'General',
    subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
    problem TEXT NOT NULL,
    node_count INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER,
    breakdown_json TEXT NOT NULL DEFAULT '{}',
    visual_table_json TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`;
