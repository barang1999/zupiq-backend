// ─── Enums ────────────────────────────────────────────────────────────────────

export type EducationLevel =
  | "elementary"
  | "middle_school"
  | "high_school"
  | "undergraduate"
  | "graduate"
  | "professional";

export type Language =
  | "en"
  | "fr"
  | "es"
  | "ar"
  | "zh"
  | "hi"
  | "pt"
  | "de"
  | "ja"
  | "ko"
  | "km";

export const SUPPORTED_LANGUAGES: readonly Language[] = [
  "en", "fr", "es", "ar", "zh", "hi", "pt", "de", "ja", "ko", "km",
] as const;

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface UserPreferences {
  // Onboarding fields
  username?: string;
  subjects?: string[];
  ai_voice?: boolean;
  daily_reminders?: boolean;
  onboarding_completed?: boolean;

  // Extended preferences
  learning_style?: "visual" | "auditory" | "reading" | "kinesthetic";
  preferred_subjects?: string[];
  daily_goal_minutes?: number;
  notification_enabled?: boolean;
  dark_mode?: boolean;
  ai_explanation_style?: "simple" | "detailed" | "socratic";
}

export interface User {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  education_level: EducationLevel;
  grade: string | null;
  language: Language;
  preferences: UserPreferences;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export type PublicUser = Omit<User, "password_hash">;

export interface CreateUserDTO {
  email: string;
  password: string;
  full_name: string;
  education_level?: EducationLevel;
  grade?: string;
  language?: Language;
}

export interface UpdateUserDTO {
  full_name?: string;
  education_level?: EducationLevel;
  grade?: string;
  language?: Language;
  avatar_url?: string;
  preferences?: Partial<UserPreferences>;
}

// ─── DB Schema SQL ────────────────────────────────────────────────────────────

export const USER_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    education_level TEXT DEFAULT 'high_school',
    grade TEXT,
    language TEXT DEFAULT 'en',
    preferences TEXT DEFAULT '{}',
    avatar_url TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`;

// ─── Default preferences ──────────────────────────────────────────────────────

export const DEFAULT_PREFERENCES: UserPreferences = {
  // Onboarding fields
  username: "",
  subjects: [],
  ai_voice: true,
  daily_reminders: true,
  onboarding_completed: false,

  // Extended preferences
  learning_style: "visual",
  preferred_subjects: [],
  daily_goal_minutes: 30,
  notification_enabled: true,
  dark_mode: true,
  ai_explanation_style: "detailed",
};
