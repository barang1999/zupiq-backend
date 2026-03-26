// ─── Enums ────────────────────────────────────────────────────────────────────

export type DifficultyLevel = "beginner" | "intermediate" | "advanced" | "expert";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface Subject {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  topic_count?: number;
  created_at: string;
}

export interface Topic {
  id: string;
  subject_id: string;
  name: string;
  slug: string;
  description: string | null;
  order_index: number;
  lesson_count?: number;
  created_at: string;
  // Joined
  subject_name?: string;
}

export interface Lesson {
  id: string;
  topic_id: string;
  title: string;
  content: string | null;
  difficulty: DifficultyLevel;
  order_index: number;
  created_at: string;
  updated_at: string;
  // Joined
  topic_name?: string;
  subject_name?: string;
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateSubjectDTO {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
}

export interface CreateTopicDTO {
  subject_id: string;
  name: string;
  description?: string;
  order_index?: number;
}

export interface CreateLessonDTO {
  topic_id: string;
  title: string;
  content?: string;
  difficulty?: DifficultyLevel;
  order_index?: number;
}

export interface UpdateLessonDTO {
  title?: string;
  content?: string;
  difficulty?: DifficultyLevel;
  order_index?: number;
}
