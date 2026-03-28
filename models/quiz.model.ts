export type QuizLevel = "easy" | "medium" | "hard";
export type QuizMode = "mcq" | "short_answer" | "numeric" | "written" | "mixed";
export type QuizStatus = "draft" | "active" | "archived";
export type AttemptStatus = "in_progress" | "submitted" | "graded";

export interface Quiz {
  id: string;
  user_id: string;
  subject_id: string | null;
  topic_id: string | null;
  title: string;
  description: string | null;
  level: QuizLevel;
  specific_area: string | null;
  quiz_mode: QuizMode;
  question_count: number;
  total_marks: number;
  status: QuizStatus;
  generation_prompt: Record<string, unknown>;
  generation_context: Record<string, unknown>;
  ai_model: string | null;
  ai_provider: string | null;
  ai_version: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuizQuestion {
  id: string;
  quiz_id: string;
  question_order: number;
  question_type: QuizMode | "mcq" | "short_answer" | "numeric" | "written";
  question_text: string;
  instructions: string | null;
  options: string[];
  expected_answer: Record<string, unknown>;
  grading_rubric: Record<string, unknown>;
  explanation: string | null;
  marks: number;
  difficulty: QuizLevel;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface QuizAttempt {
  id: string;
  quiz_id: string;
  user_id: string;
  status: AttemptStatus;
  started_at: string;
  submitted_at: string | null;
  graded_at: string | null;
  score: number;
  total_marks: number;
  percentage: number;
  feedback_summary: string | null;
  strengths: string[];
  weaknesses: string[];
  improvement_areas: string[];
  ai_evaluation: Record<string, unknown>;
  ai_model: string | null;
  ai_provider: string | null;
  ai_version: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuizAnswer {
  id: string;
  attempt_id: string;
  question_id: string;
  answer_text: string | null;
  answer_json: Record<string, unknown>;
  answer_upload_id: string | null;
  extracted_text: string | null;
  extraction_confidence: number | null;
  grading_confidence: number | null;
  is_correct: boolean | null;
  awarded_marks: number;
  ai_feedback: string | null;
  correction: string | null;
  review_required: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserTopicMastery {
  id: string;
  user_id: string;
  subject_id: string | null;
  topic_id: string | null;
  level: string | null;
  mastery_score: number;
  quizzes_taken: number;
  average_score: number;
  last_quiz_at: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
}

export interface GenerateQuizDTO {
  subjectId?: string | null;
  topicId?: string | null;
  level?: QuizLevel;
  specificArea?: string;
  quizMode?: QuizMode;
  questionCount?: number;
}

export interface SaveQuizAnswerDTO {
  questionId: string;
  answerText?: string;
  answerJson?: Record<string, unknown>;
}

export interface QuizQuestionPayload {
  order: number;
  type: "mcq" | "short_answer" | "numeric" | "written";
  text: string;
  instructions?: string;
  options?: string[];
  expectedAnswer?: Record<string, unknown>;
  gradingRubric?: Record<string, unknown>;
  marks?: number;
  difficulty?: QuizLevel;
  explanation?: string;
}

export interface QuizGenerationPayload {
  title: string;
  description?: string;
  questions: QuizQuestionPayload[];
}

export interface GradedAnswerPayload {
  questionId: string;
  isCorrect: boolean;
  awardedMarks: number;
  gradingConfidence: number;
  feedback: string;
  correction?: string | null;
}

export interface GradingPayload {
  score: number;
  totalMarks: number;
  percentage: number;
  feedbackSummary: string;
  strengths: string[];
  weaknesses: string[];
  improvementAreas: string[];
  answers: GradedAnswerPayload[];
}
