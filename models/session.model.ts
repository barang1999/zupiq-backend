// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface StudySession {
  id: string;
  user_id: string;
  title: string;
  subject: string;
  problem: string;
  node_count: number;
  duration_seconds: number | null;
  breakdown_json: string; // serialized ProblemBreakdown
  created_at: string;
}

export interface CreateSessionDTO {
  title: string;
  subject: string;
  problem: string;
  node_count: number;
  duration_seconds?: number;
  breakdown_json: string;
}

export interface UpdateSessionDTO {
  title?: string;
  subject?: string;
  problem?: string;
  node_count?: number;
  duration_seconds?: number;
  breakdown_json?: string;
}

// ─── DB Schema SQL ────────────────────────────────────────────────────────────

export const STUDY_SESSIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS study_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT 'General',
    problem TEXT NOT NULL,
    node_count INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER,
    breakdown_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  )
`;
