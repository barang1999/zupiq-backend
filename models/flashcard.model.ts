// ─── Enums ────────────────────────────────────────────────────────────────────

export type CardDifficulty = "easy" | "medium" | "hard";

export type StudyMode = "classic" | "spaced_repetition" | "quiz";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface FlashcardDeck {
  id: string;
  user_id: string;
  lesson_id: string | null;
  title: string;
  description: string | null;
  subject_id: string | null;
  subject_name?: string | null;
  card_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Flashcard {
  id: string;
  deck_id: string;
  front: string;
  back: string;
  hint: string | null;
  difficulty: CardDifficulty;
  last_reviewed_at: string | null;
  next_review_at: string | null;
  review_count: number;
  created_at: string;
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateDeckDTO {
  title: string;
  description?: string;
  subject_id?: string;
  subject?: string;
  lesson_id?: string;
}

export interface UpdateDeckDTO {
  title?: string;
  description?: string;
  subject_id?: string;
  subject?: string;
}

export interface CreateFlashcardDTO {
  front: string;
  back: string;
  hint?: string;
  difficulty?: CardDifficulty;
}

export interface ReviewFlashcardDTO {
  deck_id: string;
  card_id: string;
  rating: 1 | 2 | 3 | 4 | 5; // 1=again, 3=good, 5=easy (SM-2 style)
}

// ─── AI Generation Request ────────────────────────────────────────────────────

export interface GenerateFlashcardsDTO {
  lesson_id?: string;
  content: string;
  subject_id?: string;
  subject?: string;
  count?: number; // how many cards to generate
  difficulty?: CardDifficulty;
  deck_title?: string;
}
