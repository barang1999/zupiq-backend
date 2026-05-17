// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface StudySession {
  id: string;
  user_id: string;
  title: string;
  /** Derived display name resolved from subject_id — not stored as a DB column. */
  subject: string;
  subject_id: string | null;
  /** Derived display slug resolved from topic_id — not stored as a DB column. */
  topic: string | null;
  topic_id: string | null;
  problem: string;
  problem_json?: unknown | null;
  node_count: number;
  duration_seconds: number | null;
  // Serialized solution payload. Legacy sessions store ProblemBreakdown;
  // solution-first sessions store ProblemSolutionFirst and defer explanation nodes.
  breakdown_json: string;
  visual_table_json?: string | null;
  /** Public URL of the image uploaded to create this session, if any. */
  image_url?: string | null;
  created_at: string;
  /** Populated by getUserSessions — caller's access level for this session. */
  user_role?: 'owner' | 'editor' | 'viewer';
}

export interface CreateSessionDTO {
  title: string;
  /** Human-readable subject name; resolved to subject_id via resolveOrCreateSubjectId. */
  subject: string;
  subject_id?: string | null;
  /** Human-readable topic slug; resolved to topic_id. Not stored directly. */
  topic?: string | null;
  topic_id?: string | null;
  problem: string;
  problem_json?: unknown | null;
  node_count: number;
  duration_seconds?: number;
  breakdown_json: unknown;
  visual_table_json?: unknown | null;
  image_url?: string | null;
}

export interface UpdateSessionDTO {
  title?: string;
  /** Ignored on DB write (column dropped); use subject_id to change subject. */
  subject?: string;
  subject_id?: string | null;
  /** Ignored on DB write (column dropped); use topic_id to change topic. */
  topic?: string | null;
  topic_id?: string | null;
  problem?: string;
  node_count?: number;
  duration_seconds?: number;
  breakdown_json?: unknown;
  visual_table_json?: unknown | null;
}

// ─── DB Schema SQL ────────────────────────────────────────────────────────────

export const STUDY_SESSIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS study_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
    topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL,
    problem JSONB NOT NULL DEFAULT '{}',
    node_count INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER,
    breakdown_json JSONB NOT NULL DEFAULT '{}',
    visual_table_json TEXT,
    image_url TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`;
