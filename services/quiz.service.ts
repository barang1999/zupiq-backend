import { GoogleGenAI } from "@google/genai";
import { env } from "../config/env.js";
import { getSupabaseAdmin } from "../config/supabase.js";
import {
  GenerateQuizDTO,
  GradedAnswerPayload,
  GradingPayload,
  Quiz,
  QuizAttempt,
  QuizGenerationPayload,
  QuizLevel,
  QuizMode,
  QuizQuestion,
  SaveQuizAnswerDTO,
  ValidateQuizAnswerDTO,
  ValidateQuizAnswerResult,
} from "../models/quiz.model.js";
import { generateId, nowISO } from "../utils/helpers.js";
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../api/middlewares/error.middleware.js";
import { getUserById } from "./user.service.js";
import { getUploadById, readUploadAsBase64 } from "./upload.service.js";
import { extractProblemFromImage } from "./ai/gemini.service.js";
import { logger } from "../utils/logger.js";

const QUIZ_MODES: QuizMode[] = ["mcq", "short_answer", "numeric", "written", "mixed"];
const QUESTION_TYPES = ["mcq", "short_answer", "numeric", "written"] as const;

interface QuizWithQuestions {
  quiz: Quiz;
  questions: QuizQuestion[];
}

interface QuizQuestionEvaluation {
  questionId: string;
  isCorrect: boolean;
  awardedMarks: number;
  gradingConfidence: number;
  feedback: string;
  correction: string | null;
  source: "deterministic" | "ai" | "fallback";
}

interface GradeOpenEndedAIResponse {
  answers: GradedAnswerPayload[];
  feedbackSummary?: string;
  strengths?: string[];
  weaknesses?: string[];
  improvementAreas?: string[];
}

interface AttemptResult {
  attempt: QuizAttempt;
  quiz: Quiz;
  questions: QuizQuestion[];
  answers: Array<Record<string, unknown>>;
}

export interface QuizHistoryStats {
  quizzesCount: number;
  attemptsCount: number;
  gradedAttemptsCount: number;
  totalScore: number;
  baseScore: number;
  practiceScoreGain: number;
  lastEarnedScore: number;
  totalMarks: number;
  averagePercentage: number;
  totalXp: number;
  baseXp: number;
  practiceXpGain: number;
  lastEarnedXp: number;
  streakDays: number;
  streakByDay: QuizHistoryStreakDay[];
}

export interface QuizHistoryStreakDay {
  date: string;
  dayLabel: string;
  completed: boolean;
  inCurrentStreak: boolean;
}

let aiClient: GoogleGenAI | null = null;

function getAIClient(): GoogleGenAI {
  if (!env.GEMINI_API_KEY) {
    throw new AppError("GEMINI_API_KEY is not configured", 500);
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }
  return aiClient;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeQuizMode(value: unknown): QuizMode {
  if (typeof value !== "string") return "mixed";
  return QUIZ_MODES.includes(value as QuizMode) ? (value as QuizMode) : "mixed";
}

function normalizeQuizLevel(value: unknown): QuizLevel {
  if (value === "easy" || value === "medium" || value === "hard") return value;
  return "medium";
}

function normalizeQuestionType(value: unknown): typeof QUESTION_TYPES[number] {
  if (value === "mcq" || value === "short_answer" || value === "numeric" || value === "written") {
    return value;
  }
  return "short_answer";
}

function questionTypesForMode(mode: QuizMode): Array<typeof QUESTION_TYPES[number]> {
  if (mode === "mixed") return [...QUESTION_TYPES];
  return [normalizeQuestionType(mode)];
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractFirstJsonValue(text: string): string | null {
  const start = text.search(/[\[{]/);
  if (start < 0) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }

    if (ch === "}" || ch === "]") {
      const top = stack[stack.length - 1];
      if ((ch === "}" && top === "{") || (ch === "]" && top === "[")) {
        stack.pop();
        if (stack.length === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
  }

  return null;
}

function repairCommonJsonIssues(input: string): string {
  return input
    .replace(/[\u0000-\u001F]/g, (ch) => {
      if (ch === "\n" || ch === "\r" || ch === "\t") return ch;
      return " ";
    })
    .replace(/\\(?!["\\/bfnrtu])/g, "\\\\")
    .replace(/,\s*([}\]])/g, "$1");
}

function parseJsonLoose<T>(raw: string): T | null {
  const cleaned = stripCodeFence(raw || "").trim();
  if (!cleaned) return null;

  const extracted = extractFirstJsonValue(cleaned);
  const candidates = [cleaned, extracted]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\u2028|\u2029/g, " "));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      try {
        return JSON.parse(repairCommonJsonIssues(candidate)) as T;
      } catch {
        // Try next candidate.
      }
    }
  }

  return null;
}

function normalizeOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeExpectedAnswer(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { value };
  }
  return {};
}

function normalizeRubric(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function coerceQuestionPayload(
  raw: unknown,
  orderIndex: number,
  defaultLevel: QuizLevel,
  allowedTypes: Array<typeof QUESTION_TYPES[number]>
) {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const questionType = normalizeQuestionType(source.type);
  const normalizedType = allowedTypes.includes(questionType) ? questionType : allowedTypes[0];
  const text = typeof source.text === "string" ? source.text.trim() : "";
  const instructions = typeof source.instructions === "string" ? source.instructions.trim() : "";
  const options = normalizeOptions(source.options);
  const marks = clampNumber(Number(source.marks ?? 1) || 1, 0.25, 20);
  const difficulty = normalizeQuizLevel(source.difficulty ?? defaultLevel);
  const explanation = typeof source.explanation === "string" ? source.explanation.trim() : "";

  return {
    order: Number(source.order) > 0 ? Math.floor(Number(source.order)) : orderIndex + 1,
    type: normalizedType,
    text: text || `Question ${orderIndex + 1}`,
    instructions: instructions || null,
    options: normalizedType === "mcq" ? options.slice(0, 6) : [],
    expectedAnswer: normalizeExpectedAnswer(source.expectedAnswer),
    gradingRubric: normalizeRubric(source.gradingRubric),
    marks,
    difficulty,
    explanation: explanation || null,
  };
}

function fallbackQuizPayload(context: {
  subjectName: string;
  topicName: string;
  specificArea: string;
  level: QuizLevel;
  quizMode: QuizMode;
  questionCount: number;
}): QuizGenerationPayload {
  const baseTitle = context.specificArea || context.topicName || context.subjectName || "Practice Quiz";
  const allowedTypes = questionTypesForMode(context.quizMode);

  const questions = Array.from({ length: context.questionCount }).map((_, idx) => {
    const type = allowedTypes[idx % allowedTypes.length];

    if (type === "mcq") {
      return {
        order: idx + 1,
        type,
        text: `Which statement best describes a key concept in ${baseTitle}?`,
        instructions: "Select the best answer.",
        options: [
          `Core principle of ${baseTitle}`,
          `Unrelated idea`,
          `A contradictory statement`,
          `Not enough information`,
        ],
        expectedAnswer: { value: `Core principle of ${baseTitle}` },
        gradingRubric: {},
        marks: 1,
        difficulty: context.level,
        explanation: `This checks conceptual understanding of ${baseTitle}.`,
      };
    }

    if (type === "numeric") {
      return {
        order: idx + 1,
        type,
        text: `Compute 12 + ${idx + 3}.`,
        instructions: "Enter only the final numeric value.",
        options: [],
        expectedAnswer: { value: 12 + idx + 3, tolerance: 0 },
        gradingRubric: {},
        marks: 1,
        difficulty: context.level,
        explanation: "Add the two numbers directly.",
      };
    }

    return {
      order: idx + 1,
      type,
      text: `Explain one important idea about ${baseTitle} in 2-4 sentences.`,
      instructions: "Be specific and include at least one concrete detail.",
      options: [],
      expectedAnswer: { value: `Any accurate explanation of ${baseTitle}.` },
      gradingRubric: {
        criteria: [
          "Accuracy of concept",
          "Clarity of explanation",
          "Use of concrete detail",
        ],
      },
      marks: type === "written" ? 2 : 1,
      difficulty: context.level,
      explanation: `Strong answers should accurately describe ${baseTitle}.`,
    };
  });

  return {
    title: `${baseTitle} Practice`,
    description: `Auto-generated ${context.quizMode} quiz for ${baseTitle}.`,
    questions,
  };
}

async function generateQuizFromAI(context: {
  subjectName: string;
  topicName: string;
  specificArea: string;
  level: QuizLevel;
  quizMode: QuizMode;
  questionCount: number;
  userLanguage: string;
  educationLevel: string;
}): Promise<{ payload: QuizGenerationPayload; raw: string; source: "ai" | "fallback" }> {
  const allowedTypes = questionTypesForMode(context.quizMode);
  const prompt = `Generate a strict JSON quiz for Zupiq.

Context:
- Subject: ${context.subjectName || "General"}
- Topic: ${context.topicName || "General Topic"}
- Specific Area: ${context.specificArea || "General practice"}
- Difficulty Level: ${context.level}
- Quiz mode: ${context.quizMode}
- Allowed question types: ${allowedTypes.join(", ")}
- Number of questions: ${context.questionCount}
- Student education level: ${context.educationLevel}
- Language: ${context.userLanguage}

Rules:
- Return ONLY valid JSON.
- Do not include markdown.
- Keep question order unique and sequential.
- Ensure each question has marks > 0.
- For mcq questions provide 4 options and expectedAnswer.value exactly matching one option.
- For numeric questions expectedAnswer.value must be numeric.
- For short_answer/written include a useful gradingRubric.

JSON schema:
{
  "title": "string",
  "description": "string",
  "questions": [
    {
      "order": 1,
      "type": "mcq|short_answer|numeric|written",
      "text": "string",
      "instructions": "string",
      "options": ["string"],
      "expectedAnswer": {},
      "gradingRubric": {},
      "marks": 1,
      "difficulty": "easy|medium|hard",
      "explanation": "string"
    }
  ]
}`;

  try {
    const client = getAIClient();
    const response = await client.models.generateContent({
      model: env.GEMINI_MODEL,
      config: {
        responseMimeType: "application/json",
        temperature: 0.25,
        maxOutputTokens: 8192,
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const raw = response.text ?? "";
    const parsed = parseJsonLoose<QuizGenerationPayload>(raw);

    if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      throw new Error("AI generation returned invalid quiz payload");
    }

    return {
      payload: parsed,
      raw,
      source: "ai",
    };
  } catch (err) {
    logger.warn("[quiz] AI generation failed, using fallback", {
      message: err instanceof Error ? err.message : String(err),
    });

    return {
      payload: fallbackQuizPayload(context),
      raw: "",
      source: "fallback",
    };
  }
}

function normalizeGeneratedQuiz(
  payload: QuizGenerationPayload,
  context: {
    level: QuizLevel;
    quizMode: QuizMode;
    questionCount: number;
  }
): QuizGenerationPayload {
  const allowedTypes = questionTypesForMode(context.quizMode);
  const normalizedQuestions = (payload.questions ?? [])
    .map((question, idx) => coerceQuestionPayload(question, idx, context.level, allowedTypes))
    .filter((question) => question.text.length > 0)
    .slice(0, context.questionCount);

  if (normalizedQuestions.length === 0) {
    return fallbackQuizPayload({
      subjectName: "General",
      topicName: "General Topic",
      specificArea: "General Practice",
      level: context.level,
      quizMode: context.quizMode,
      questionCount: context.questionCount,
    });
  }

  // Enforce deterministic ordering and ensure mcq options/answers are usable.
  const finalQuestions = normalizedQuestions.map((question, idx) => {
    let options = question.options;
    const expected = { ...question.expectedAnswer };

    if (question.type === "mcq") {
      if (options.length < 2) {
        options = ["Option A", "Option B", "Option C", "Option D"];
      }
      const expectedValue = typeof expected.value === "string" ? expected.value.trim() : "";
      if (!expectedValue || !options.some((option) => option.toLowerCase() === expectedValue.toLowerCase())) {
        expected.value = options[0];
      }
    }

    if (question.type === "numeric") {
      const numeric = Number(expected.value);
      if (!Number.isFinite(numeric)) {
        expected.value = 0;
      }
      if (!Number.isFinite(Number(expected.tolerance))) {
        expected.tolerance = 0.01;
      }
    }

    return {
      ...question,
      order: idx + 1,
      options,
      expectedAnswer: expected,
    };
  });

  return {
    title: (payload.title || "Practice Quiz").trim() || "Practice Quiz",
    description: (payload.description || "").trim() || "AI-generated quiz",
    questions: finalQuestions,
  };
}

async function resolveGenerationContext(dto: GenerateQuizDTO, userId: string) {
  const db = getSupabaseAdmin();
  const subjectId = dto.subjectId ?? null;
  const topicId = dto.topicId ?? null;

  let subjectName = "General";
  let topicName = "General Topic";

  if (subjectId) {
    const { data: subject } = await db
      .from("subjects")
      .select("id, name")
      .eq("id", subjectId)
      .single();

    if (!subject) throw new ValidationError("Invalid subjectId");
    subjectName = subject.name;
  }

  if (topicId) {
    const { data: topic } = await db
      .from("topics")
      .select("id, name, subject_id")
      .eq("id", topicId)
      .single();

    if (!topic) throw new ValidationError("Invalid topicId");
    if (subjectId && topic.subject_id !== subjectId) {
      throw new ValidationError("topicId does not belong to selected subjectId");
    }
    topicName = topic.name;
  }

  const user = await getUserById(userId);

  return {
    subjectId,
    topicId,
    subjectName,
    topicName,
    userLanguage: user?.language ?? "en",
    educationLevel: user?.education_level ?? "high_school",
  };
}

export async function generateQuizForUser(userId: string, dto: GenerateQuizDTO): Promise<QuizWithQuestions> {
  const level = normalizeQuizLevel(dto.level ?? "medium");
  const quizMode = normalizeQuizMode(dto.quizMode ?? "mixed");
  const questionCount = clampNumber(Number(dto.questionCount ?? 8), 3, 20);
  const specificArea = String(dto.specificArea ?? "").trim();

  const context = await resolveGenerationContext(dto, userId);
  const generated = await generateQuizFromAI({
    subjectName: context.subjectName,
    topicName: context.topicName,
    specificArea,
    level,
    quizMode,
    questionCount,
    userLanguage: context.userLanguage,
    educationLevel: context.educationLevel,
  });

  const normalized = normalizeGeneratedQuiz(generated.payload, {
    level,
    quizMode,
    questionCount,
  });

  const totalMarks = normalized.questions.reduce((sum, question) => sum + getQuestionMarks(question), 0);
  const db = getSupabaseAdmin();

  const quizId = generateId();
  const createdAt = nowISO();

  const { error: quizError } = await db.from("quizzes").insert({
    id: quizId,
    user_id: userId,
    subject_id: context.subjectId,
    topic_id: context.topicId,
    title: normalized.title,
    description: normalized.description,
    level,
    specific_area: specificArea || null,
    quiz_mode: quizMode,
    question_count: normalized.questions.length,
    total_marks: totalMarks,
    status: "active",
    generation_prompt: {
      level,
      quizMode,
      questionCount,
      subjectName: context.subjectName,
      topicName: context.topicName,
      specificArea,
    },
    generation_context: {
      source: generated.source,
      userLanguage: context.userLanguage,
      educationLevel: context.educationLevel,
    },
    ai_model: generated.source === "ai" ? env.GEMINI_MODEL : "fallback",
    ai_provider: generated.source === "ai" ? "google" : "system",
    ai_version: "v1",
    created_at: createdAt,
    updated_at: createdAt,
  });

  if (quizError) throw new AppError(quizError.message, 500);

  const questionRows = normalized.questions.map((question) => ({
    id: generateId(),
    quiz_id: quizId,
    question_order: question.order,
    question_type: question.type,
    question_text: question.text,
    instructions: question.instructions,
    options: question.options,
    expected_answer: question.expectedAnswer,
    grading_rubric: question.gradingRubric,
    explanation: question.explanation,
    marks: question.marks,
    difficulty: question.difficulty,
    metadata: {},
    created_at: createdAt,
  }));

  const { error: questionError } = await db.from("quiz_questions").insert(questionRows);
  if (questionError) throw new AppError(questionError.message, 500);

  const created = await getQuizForUser(userId, quizId);
  if (!created) throw new AppError("Failed to load generated quiz", 500);
  return created;
}

export async function getQuizForUser(userId: string, quizId: string): Promise<QuizWithQuestions | null> {
  const db = getSupabaseAdmin();

  const { data: quiz, error: quizError } = await db
    .from("quizzes")
    .select("*")
    .eq("id", quizId)
    .eq("user_id", userId)
    .single();

  if (quizError || !quiz) return null;

  const { data: questions, error: questionError } = await db
    .from("quiz_questions")
    .select("*")
    .eq("quiz_id", quizId)
    .order("question_order", { ascending: true });

  if (questionError) throw new AppError(questionError.message, 500);

  return {
    quiz: quiz as Quiz,
    questions: (questions ?? []) as QuizQuestion[],
  };
}

export async function listUserQuizzes(userId: string, limit = 10): Promise<Array<Record<string, unknown>>> {
  const db = getSupabaseAdmin();
  const safeLimit = clampNumber(Number(limit) || 10, 1, 50);

  const { data: quizzes, error } = await db
    .from("quizzes")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw new AppError(error.message, 500);

  const quizRows = (quizzes ?? []) as Quiz[];
  if (quizRows.length === 0) return [];

  const quizIds = quizRows.map((quiz) => quiz.id);

  const { data: attempts } = await db
    .from("quiz_attempts")
    .select("*")
    .eq("user_id", userId)
    .in("quiz_id", quizIds)
    .order("created_at", { ascending: false });

  const latestAttemptByQuiz = new Map<string, QuizAttempt>();
  const attemptsByQuiz = new Map<string, QuizAttempt[]>();
  for (const row of (attempts ?? []) as QuizAttempt[]) {
    if (!attemptsByQuiz.has(row.quiz_id)) {
      attemptsByQuiz.set(row.quiz_id, []);
    }
    attemptsByQuiz.get(row.quiz_id)!.push(row);

    if (!latestAttemptByQuiz.has(row.quiz_id)) {
      latestAttemptByQuiz.set(row.quiz_id, row);
    }
  }

  return quizRows.map((quiz) => {
    const quizAttempts = attemptsByQuiz.get(quiz.id) ?? [];
    const gradedAttempts = quizAttempts.filter((attempt) => attempt.status === "graded");
    const gradedAsc = [...gradedAttempts].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
    const firstScore = Number(gradedAsc[0]?.score || 0);
    const bestScore = gradedAttempts.reduce((best, attempt) => Math.max(best, Number(attempt.score || 0)), 0);
    const bestPercentage = gradedAttempts.reduce((best, attempt) => Math.max(best, Number(attempt.percentage || 0)), 0);
    const cumulativeScore = gradedAttempts.reduce((sum, attempt) => sum + Number(attempt.score || 0), 0);
    const cumulativeXp = Math.round(cumulativeScore * 10);
    const scoreGain = Number(Math.max(0, cumulativeScore - firstScore).toFixed(2));
    const latestAttempt = latestAttemptByQuiz.get(quiz.id) ?? null;

    return {
      ...quiz,
      latest_attempt: latestAttempt,
      attempts_count: quizAttempts.length,
      graded_attempts_count: gradedAttempts.length,
      best_score: Number(bestScore.toFixed(2)),
      best_percentage: Number(bestPercentage.toFixed(2)),
      cumulative_score: Number(cumulativeScore.toFixed(2)),
      cumulative_xp: cumulativeXp,
      first_score: Number(firstScore.toFixed(2)),
      score_gain: scoreGain,
    };
  });
}

function isoDateKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function dateFromKey(key: string): Date {
  const dt = new Date(`${key}T00:00:00.000Z`);
  return dt;
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dayLabelFromUtcDate(date: Date): string {
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return labels[date.getUTCDay()] ?? "Day";
}

function getCompletionDateKeys(attempts: QuizAttempt[]): string[] {
  return attempts
    .map((attempt) => {
      if (attempt.status === "in_progress") return null;
      return isoDateKey(attempt.graded_at || attempt.submitted_at || attempt.created_at);
    })
    .filter((key): key is string => Boolean(key));
}

function getCurrentStreakKeySetFromSortedKeys(sortedDescKeys: string[]): Set<string> {
  const streakKeys = new Set<string>();
  if (!sortedDescKeys.length) return streakKeys;

  const latestKey = sortedDescKeys[0];
  const todayKey = new Date().toISOString().slice(0, 10);
  const yesterdayKey = addUtcDays(dateFromKey(todayKey), -1).toISOString().slice(0, 10);

  if (latestKey !== todayKey && latestKey !== yesterdayKey) {
    return streakKeys;
  }

  streakKeys.add(latestKey);
  let cursor = dateFromKey(latestKey);

  for (let i = 1; i < sortedDescKeys.length; i += 1) {
    const expectedPrev = addUtcDays(cursor, -1).toISOString().slice(0, 10);
    if (sortedDescKeys[i] !== expectedPrev) break;
    streakKeys.add(sortedDescKeys[i]);
    cursor = dateFromKey(sortedDescKeys[i]);
  }

  return streakKeys;
}

function buildRecentStreakByDay(attempts: QuizAttempt[], days = 7): QuizHistoryStreakDay[] {
  const safeDays = clampNumber(Number(days) || 7, 1, 14);
  const completionKeyList = getCompletionDateKeys(attempts);
  const completedSet = new Set<string>(completionKeyList);
  const uniqueSorted = Array.from(completedSet).sort((a, b) => b.localeCompare(a));
  const currentStreakSet = getCurrentStreakKeySetFromSortedKeys(uniqueSorted);
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const startDate = addUtcDays(dateFromKey(todayKey), -(safeDays - 1));

  return Array.from({ length: safeDays }, (_, index) => {
    const date = addUtcDays(startDate, index);
    const dateKey = date.toISOString().slice(0, 10);
    return {
      date: dateKey,
      dayLabel: dayLabelFromUtcDate(date),
      completed: completedSet.has(dateKey),
      inCurrentStreak: currentStreakSet.has(dateKey),
    };
  });
}

function computeDailyStreak(attempts: QuizAttempt[]): number {
  if (!attempts.length) return 0;
  const completionDateKeys = getCompletionDateKeys(attempts);

  if (completionDateKeys.length === 0) return 0;

  const uniqueSorted = Array.from(new Set(completionDateKeys)).sort((a, b) => b.localeCompare(a));
  return getCurrentStreakKeySetFromSortedKeys(uniqueSorted).size;
}

export async function getQuizHistoryStats(userId: string): Promise<QuizHistoryStats> {
  const db = getSupabaseAdmin();
  const { data: attempts, error } = await db
    .from("quiz_attempts")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw new AppError(error.message, 500);

  const rows = (attempts ?? []) as QuizAttempt[];
  const graded = rows.filter((attempt) => attempt.status === "graded");
  const totalScoreRaw = graded.reduce((sum, attempt) => sum + Number(attempt.score || 0), 0);
  const totalMarksRaw = graded.reduce((sum, attempt) => sum + Number(attempt.total_marks || 0), 0);
  const firstGradedAttemptByQuiz = new Map<string, QuizAttempt>();
  const gradedAsc = [...graded].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  for (const attempt of gradedAsc) {
    if (!attempt.quiz_id) continue;
    if (!firstGradedAttemptByQuiz.has(attempt.quiz_id)) {
      firstGradedAttemptByQuiz.set(attempt.quiz_id, attempt);
    }
  }
  const baseScoreRaw = Array.from(firstGradedAttemptByQuiz.values()).reduce(
    (sum, attempt) => sum + Number(attempt.score || 0),
    0
  );
  const totalScore = Number(totalScoreRaw.toFixed(2));
  const baseScore = Number(baseScoreRaw.toFixed(2));
  const practiceScoreGain = Number(Math.max(0, totalScoreRaw - baseScoreRaw).toFixed(2));
  const lastEarnedScore = Number((graded[0]?.score || 0).toFixed(2));
  const totalMarks = Number(totalMarksRaw.toFixed(2));
  const averagePercentageRaw = graded.length > 0
    ? graded.reduce((sum, attempt) => sum + Number(attempt.percentage || 0), 0) / graded.length
    : 0;
  const averagePercentage = Number(averagePercentageRaw.toFixed(2));
  const totalXp = Math.round(totalScore * 10);
  const baseXp = Math.round(baseScore * 10);
  const practiceXpGain = Math.max(0, totalXp - baseXp);
  const lastEarnedXp = Math.round(lastEarnedScore * 10);
  const quizzesCount = new Set(rows.map((attempt) => attempt.quiz_id).filter(Boolean)).size;
  const streakDays = computeDailyStreak(rows);
  const streakByDay = buildRecentStreakByDay(rows, 7);

  return {
    quizzesCount,
    attemptsCount: rows.length,
    gradedAttemptsCount: graded.length,
    totalScore,
    baseScore,
    practiceScoreGain,
    lastEarnedScore,
    totalMarks,
    averagePercentage,
    totalXp,
    baseXp,
    practiceXpGain,
    lastEarnedXp,
    streakDays,
    streakByDay,
  };
}

async function getAttemptForUser(attemptId: string, userId: string): Promise<QuizAttempt> {
  const db = getSupabaseAdmin();
  const { data: attempt, error } = await db
    .from("quiz_attempts")
    .select("*")
    .eq("id", attemptId)
    .eq("user_id", userId)
    .single();

  if (error || !attempt) throw new NotFoundError("Quiz attempt");
  return attempt as QuizAttempt;
}

async function getQuestionForAttempt(attempt: QuizAttempt, questionId: string): Promise<QuizQuestion> {
  const db = getSupabaseAdmin();
  const { data: question, error } = await db
    .from("quiz_questions")
    .select("*")
    .eq("id", questionId)
    .eq("quiz_id", attempt.quiz_id)
    .single();

  if (error || !question) throw new NotFoundError("Quiz question");
  return question as QuizQuestion;
}

export async function createQuizAttempt(userId: string, quizId: string): Promise<QuizAttempt> {
  const db = getSupabaseAdmin();

  const { data: quiz, error: quizError } = await db
    .from("quizzes")
    .select("*")
    .eq("id", quizId)
    .eq("user_id", userId)
    .single();

  if (quizError || !quiz) throw new NotFoundError("Quiz");

  const now = nowISO();
  const row = {
    id: generateId(),
    quiz_id: quizId,
    user_id: userId,
    status: "in_progress",
    started_at: now,
    submitted_at: null,
    graded_at: null,
    score: 0,
    total_marks: Number((quiz as Quiz).total_marks ?? 0),
    percentage: 0,
    feedback_summary: null,
    strengths: [],
    weaknesses: [],
    improvement_areas: [],
    ai_evaluation: {},
    ai_model: null,
    ai_provider: null,
    ai_version: null,
    created_at: now,
    updated_at: now,
  };

  const { data: attempt, error } = await db
    .from("quiz_attempts")
    .insert(row)
    .select()
    .single();

  if (error || !attempt) throw new AppError(error?.message ?? "Failed to create attempt", 500);
  return attempt as QuizAttempt;
}

async function upsertAnswerForAttempt(
  attemptId: string,
  questionId: string,
  dto: SaveQuizAnswerDTO
) {
  const db = getSupabaseAdmin();
  const now = nowISO();

  const existing = await db
    .from("quiz_answers")
    .select("*")
    .eq("attempt_id", attemptId)
    .eq("question_id", questionId)
    .single();

  const base = existing.data as Record<string, unknown> | null;
  const answerText = typeof dto.answerText === "string" ? dto.answerText.trim() : null;
  const answerJson = dto.answerJson && typeof dto.answerJson === "object" ? dto.answerJson : {};

  const row = {
    id: (base?.id as string | undefined) ?? generateId(),
    attempt_id: attemptId,
    question_id: questionId,
    answer_text: answerText,
    answer_json: answerJson,
    answer_upload_id: (base?.answer_upload_id as string | null | undefined) ?? null,
    extracted_text: (base?.extracted_text as string | null | undefined) ?? null,
    extraction_confidence: (base?.extraction_confidence as number | null | undefined) ?? null,
    grading_confidence: null,
    is_correct: null,
    awarded_marks: 0,
    ai_feedback: null,
    correction: null,
    review_required: false,
    created_at: (base?.created_at as string | undefined) ?? now,
    updated_at: now,
  };

  const { data, error } = await db
    .from("quiz_answers")
    .upsert(row, { onConflict: "attempt_id,question_id" })
    .select()
    .single();

  if (error || !data) throw new AppError(error?.message ?? "Failed to save answer", 500);
  return data;
}

export async function saveAttemptAnswer(userId: string, attemptId: string, dto: SaveQuizAnswerDTO) {
  if (!dto.questionId) throw new ValidationError("questionId is required");

  const attempt = await getAttemptForUser(attemptId, userId);
  if (attempt.status === "graded") {
    throw new ValidationError("Cannot modify a graded attempt");
  }

  const question = await getQuestionForAttempt(attempt, dto.questionId);
  const data = await upsertAnswerForAttempt(attemptId, question.id, dto);
  const db = getSupabaseAdmin();
  const now = nowISO();

  await db
    .from("quiz_attempts")
    .update({ updated_at: now })
    .eq("id", attemptId)
    .eq("user_id", userId);

  return data;
}

export async function validateAttemptAnswer(
  userId: string,
  attemptId: string,
  dto: ValidateQuizAnswerDTO
): Promise<ValidateQuizAnswerResult> {
  if (!dto.questionId) throw new ValidationError("questionId is required");

  const attempt = await getAttemptForUser(attemptId, userId);
  if (attempt.status === "graded") {
    throw new ValidationError("Cannot validate a graded attempt");
  }

  const question = await getQuestionForAttempt(attempt, dto.questionId);
  const db = getSupabaseAdmin();
  const now = nowISO();

  const answer = await upsertAnswerForAttempt(attemptId, question.id, dto);
  const responseText = getAnswerText(answer as Record<string, unknown>);
  const lockedZeroQuestionIds = getLockedZeroQuestionIds(attempt);

  let evaluation: QuizQuestionEvaluation = !responseText.trim()
    ? {
      questionId: question.id,
      isCorrect: false,
      awardedMarks: 0,
      gradingConfidence: 0.99,
      feedback: "No answer submitted.",
      correction: expectedAnswerCorrection(question),
      source: "deterministic",
    }
    : (evaluateDeterministic(question, answer as Record<string, unknown>) ?? buildOpenEndedFallbackGrade(question, responseText));

  if (!evaluation.isCorrect) {
    lockedZeroQuestionIds.add(question.id);
  }

  if (lockedZeroQuestionIds.has(question.id) && evaluation.awardedMarks > 0) {
    evaluation = {
      ...evaluation,
      isCorrect: false,
      awardedMarks: 0,
      feedback: "Correct now, but this question scores 0 because an earlier attempt was incorrect.",
    };
  }

  const { data: updatedAnswer, error: answerUpdateError } = await db
    .from("quiz_answers")
    .update({
      grading_confidence: evaluation.gradingConfidence,
      is_correct: evaluation.isCorrect,
      awarded_marks: evaluation.awardedMarks,
      ai_feedback: evaluation.feedback,
      correction: evaluation.correction,
      review_required:
        evaluation.gradingConfidence < 0.55 ||
        ((answer as Record<string, unknown>).extraction_confidence as number | null | undefined ?? 1) < 0.55,
      updated_at: now,
    })
    .eq("attempt_id", attemptId)
    .eq("question_id", question.id)
    .select("*")
    .single();

  if (answerUpdateError || !updatedAnswer) {
    throw new AppError(answerUpdateError?.message ?? "Failed to update answer evaluation", 500);
  }

  const { data: scoreRows, error: scoreError } = await db
    .from("quiz_answers")
    .select("awarded_marks")
    .eq("attempt_id", attemptId);

  if (scoreError) throw new AppError(scoreError.message, 500);

  const runningScoreRaw = (scoreRows ?? []).reduce((sum, row) => {
    const marks = Number((row as Record<string, unknown>).awarded_marks ?? 0);
    return sum + (Number.isFinite(marks) ? marks : 0);
  }, 0);

  const runningScore = Number(runningScoreRaw.toFixed(2));
  const { data: questionRowsForTotal, error: questionTotalError } = await db
    .from("quiz_questions")
    .select("marks")
    .eq("quiz_id", attempt.quiz_id);

  if (questionTotalError) throw new AppError(questionTotalError.message, 500);

  const computedTotalMarks = (questionRowsForTotal ?? []).reduce(
    (sum, questionRow) => sum + getQuestionMarks(questionRow as { marks: unknown }),
    0
  );
  const totalMarks = Number(computedTotalMarks.toFixed(2));
  const percentage = totalMarks > 0 ? Number(((runningScore / totalMarks) * 100).toFixed(2)) : 0;
  const previousAiEvaluation = toRecord(attempt.ai_evaluation);
  const previousValidation = toRecord(previousAiEvaluation.validation);
  const nextAiEvaluation = {
    ...previousAiEvaluation,
    validation: {
      ...previousValidation,
      locked_zero_question_ids: Array.from(lockedZeroQuestionIds),
      updated_at: now,
    },
  };

  const { error: attemptUpdateError } = await db
    .from("quiz_attempts")
    .update({
      score: runningScore,
      total_marks: totalMarks,
      percentage,
      ai_evaluation: nextAiEvaluation,
      updated_at: now,
    })
    .eq("id", attemptId)
    .eq("user_id", userId);

  if (attemptUpdateError) throw new AppError(attemptUpdateError.message, 500);

  return {
    questionId: question.id,
    isCorrect: evaluation.isCorrect,
    awardedMarks: Number(evaluation.awardedMarks.toFixed(2)),
    feedback: evaluation.feedback,
    correction: evaluation.correction,
    runningScore,
    totalMarks: Number(totalMarks.toFixed(2)),
    percentage,
  };
}

function computeExtractionConfidence(text: string, warnings: string[]): number {
  const base = text.trim().length >= 30 ? 0.88 : 0.72;
  const penalty = warnings.length * 0.12;
  return clampNumber(base - penalty, 0.2, 0.99);
}

export async function attachAnswerImageToQuestion(
  userId: string,
  attemptId: string,
  questionId: string,
  uploadId: string
) {
  const attempt = await getAttemptForUser(attemptId, userId);
  if (attempt.status === "graded") {
    throw new ValidationError("Cannot attach files to a graded attempt");
  }

  const question = await getQuestionForAttempt(attempt, questionId);
  const upload = await getUploadById(uploadId);

  if (!upload) throw new NotFoundError("Upload");
  if (upload.user_id !== userId) throw new ForbiddenError("Upload does not belong to current user");

  const user = await getUserById(userId);

  let extractedText = "";
  let extractionConfidence = 0.35;
  let warnings: string[] = ["image_extraction_failed"];

  try {
    const file = await readUploadAsBase64(upload);
    const extraction = await extractProblemFromImage(
      {
        data: file.data,
        mimeType: file.mimeType,
      },
      {
        language: user?.language ?? "en",
        educationLevel: user?.education_level,
      }
    );

    extractedText = extraction.text || extraction.plainText || "";
    warnings = extraction.warnings ?? [];
    extractionConfidence = computeExtractionConfidence(extractedText, warnings);
  } catch (err) {
    logger.warn("[quiz] answer image extraction failed", {
      message: err instanceof Error ? err.message : String(err),
      uploadId,
      attemptId,
      questionId,
    });
  }

  const db = getSupabaseAdmin();
  const now = nowISO();

  const existing = await db
    .from("quiz_answers")
    .select("*")
    .eq("attempt_id", attemptId)
    .eq("question_id", question.id)
    .single();

  const base = existing.data as Record<string, unknown> | null;

  const row = {
    id: (base?.id as string | undefined) ?? generateId(),
    attempt_id: attemptId,
    question_id: question.id,
    answer_text: base?.answer_text ?? null,
    answer_json: (base?.answer_json as Record<string, unknown> | undefined) ?? {},
    answer_upload_id: upload.id,
    extracted_text: extractedText || null,
    extraction_confidence: extractionConfidence,
    grading_confidence: (base?.grading_confidence as number | null | undefined) ?? null,
    is_correct: (base?.is_correct as boolean | null | undefined) ?? null,
    awarded_marks: (base?.awarded_marks as number | undefined) ?? 0,
    ai_feedback: (base?.ai_feedback as string | null | undefined) ?? null,
    correction: (base?.correction as string | null | undefined) ?? null,
    review_required: extractionConfidence < 0.58,
    created_at: (base?.created_at as string | undefined) ?? now,
    updated_at: now,
  };

  const { data, error } = await db
    .from("quiz_answers")
    .upsert(row, { onConflict: "attempt_id,question_id" })
    .select()
    .single();

  if (error || !data) throw new AppError(error?.message ?? "Failed to attach image answer", 500);

  await db
    .from("quiz_attempts")
    .update({ updated_at: now })
    .eq("id", attemptId)
    .eq("user_id", userId);

  return {
    answer: data,
    extraction: {
      extractedText,
      extractionConfidence,
      warnings,
    },
  };
}

export async function submitQuizAttempt(userId: string, attemptId: string): Promise<QuizAttempt> {
  const attempt = await getAttemptForUser(attemptId, userId);
  if (attempt.status === "graded") return attempt;

  const db = getSupabaseAdmin();
  const now = nowISO();
  const status = "submitted";

  const { data, error } = await db
    .from("quiz_attempts")
    .update({
      status,
      submitted_at: now,
      updated_at: now,
    })
    .eq("id", attemptId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error || !data) throw new AppError(error?.message ?? "Failed to submit attempt", 500);
  return data as QuizAttempt;
}

function normalizeText(input: string): string {
  return input
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}.+\-=/ ]+/gu, "")
    .trim();
}

function getAnswerText(answer: Record<string, unknown> | null): string {
  if (!answer) return "";
  const answerText = typeof answer.answer_text === "string" ? answer.answer_text : "";
  const extracted = typeof answer.extracted_text === "string" ? answer.extracted_text : "";
  if (answerText.trim()) return answerText.trim();
  if (extracted.trim()) return extracted.trim();

  const answerJson = answer.answer_json as Record<string, unknown> | null;
  if (!answerJson) return "";

  const option = typeof answerJson.option === "string" ? answerJson.option : "";
  const value = answerJson.value;
  if (option.trim()) return option.trim();
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);

  return "";
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/,/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function getQuestionMarks(question: { marks?: unknown }): number {
  const parsed = Number(question.marks);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(2));
}

function expectedAnswerCorrection(question: QuizQuestion): string | null {
  const expected = question.expected_answer ?? {};
  const value = expected.value;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function getLockedZeroQuestionIds(attempt: QuizAttempt): Set<string> {
  const aiEvaluation = toRecord(attempt.ai_evaluation);
  const validation = toRecord(aiEvaluation.validation);
  const raw = validation.locked_zero_question_ids;
  if (!Array.isArray(raw)) return new Set<string>();
  return new Set(
    raw
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
  );
}

function evaluateDeterministic(
  question: QuizQuestion,
  answer: Record<string, unknown> | null
): QuizQuestionEvaluation | null {
  const responseText = getAnswerText(answer);

  if (question.question_type === "mcq") {
    const expected = typeof question.expected_answer?.value === "string"
      ? question.expected_answer.value
      : "";

    const normalizedExpected = normalizeText(expected);
    const normalizedResponse = normalizeText(responseText);
    const isCorrect = Boolean(normalizedExpected) && normalizedExpected === normalizedResponse;

    const questionMarks = getQuestionMarks(question);
    return {
      questionId: question.id,
      isCorrect,
      awardedMarks: isCorrect ? questionMarks : 0,
      gradingConfidence: 0.99,
      feedback: isCorrect
        ? "Correct answer."
        : expected
          ? `Incorrect. The expected answer is "${expected}".`
          : "Incorrect answer.",
      correction: isCorrect ? null : expected || null,
      source: "deterministic",
    };
  }

  if (question.question_type === "numeric") {
    const expectedRaw = (question.expected_answer ?? {}).value;
    const toleranceRaw = (question.expected_answer ?? {}).tolerance;
    const expected = parseNumericValue(expectedRaw);
    const response = parseNumericValue(responseText);
    const tolerance = Number.isFinite(Number(toleranceRaw)) ? Math.abs(Number(toleranceRaw)) : 0.01;

    if (expected === null || response === null) {
      return {
        questionId: question.id,
        isCorrect: false,
        awardedMarks: 0,
        gradingConfidence: 0.95,
        feedback: expected === null
          ? "Unable to evaluate because expected numeric answer is invalid."
          : "No valid numeric answer was provided.",
        correction: expected === null ? null : String(expected),
        source: "deterministic",
      };
    }

    const isCorrect = Math.abs(expected - response) <= tolerance;

    const questionMarks = getQuestionMarks(question);
    return {
      questionId: question.id,
      isCorrect,
      awardedMarks: isCorrect ? questionMarks : 0,
      gradingConfidence: 0.97,
      feedback: isCorrect
        ? "Correct numeric answer."
        : `Incorrect. Expected ${expected}.`,
      correction: isCorrect ? null : String(expected),
      source: "deterministic",
    };
  }

  return null;
}

function buildOpenEndedFallbackGrade(
  question: QuizQuestion,
  answerText: string
): QuizQuestionEvaluation {
  const expectedValue = typeof question.expected_answer?.value === "string"
    ? question.expected_answer.value
    : "";

  const expectedTokens = expectedValue
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 4);

  const answerNorm = answerText.toLowerCase();
  const matched = expectedTokens.filter((token) => answerNorm.includes(token)).length;
  const ratio = expectedTokens.length > 0 ? matched / expectedTokens.length : (answerText.length > 35 ? 0.6 : 0.2);

  const questionMarks = getQuestionMarks(question);
  const awardedMarks = clampNumber(questionMarks * ratio, 0, questionMarks);
  const isCorrect = ratio >= 0.65;

  return {
    questionId: question.id,
    isCorrect,
    awardedMarks: Number(awardedMarks.toFixed(2)),
    gradingConfidence: 0.58,
    feedback: isCorrect
      ? "Good response. Your answer covers most expected points."
      : "Partial response. Include more precise key points and clearer reasoning.",
    correction: expectedValue || null,
    source: "fallback",
  };
}

async function gradeOpenEndedWithAI(
  context: {
    subjectName: string;
    topicName: string;
    level: string;
    quizTitle: string;
  },
  questions: Array<{
    question: QuizQuestion;
    answerText: string;
  }>
): Promise<{ evaluations: QuizQuestionEvaluation[]; summary: Omit<GradingPayload, "score" | "totalMarks" | "percentage" | "answers"> | null; raw: Record<string, unknown> }> {
  if (questions.length === 0) {
    return {
      evaluations: [],
      summary: null,
      raw: {},
    };
  }

  const fallbackEvaluations = questions.map(({ question, answerText }) =>
    buildOpenEndedFallbackGrade(question, answerText)
  );

  try {
    const client = getAIClient();

    const prompt = `Grade the following student answers for a Zupiq quiz.

Context:
- Subject: ${context.subjectName || "General"}
- Topic: ${context.topicName || "General Topic"}
- Level: ${context.level}
- Quiz title: ${context.quizTitle}

Instructions:
- Grade each answer using the question's expectedAnswer and gradingRubric.
- Award marks between 0 and question marks.
- Return STRICT JSON only.
- Keep feedback concise and actionable.

Output JSON schema:
{
  "answers": [
    {
      "questionId": "string",
      "isCorrect": true,
      "awardedMarks": 1,
      "gradingConfidence": 0.92,
      "feedback": "string",
      "correction": "string or null"
    }
  ],
  "feedbackSummary": "string",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "improvementAreas": ["string"]
}

Questions:
${JSON.stringify(
  questions.map(({ question, answerText }) => ({
    questionId: question.id,
    questionType: question.question_type,
    questionText: question.question_text,
    instructions: question.instructions,
    expectedAnswer: question.expected_answer,
    gradingRubric: question.grading_rubric,
    marks: question.marks,
    studentAnswer: answerText,
  })),
  null,
  2
)}`;

    const response = await client.models.generateContent({
      model: env.GEMINI_MODEL,
      config: {
        responseMimeType: "application/json",
        temperature: 0.2,
        maxOutputTokens: 4096,
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const rawText = response.text ?? "";
    const parsed = parseJsonLoose<GradeOpenEndedAIResponse>(rawText);

    if (!parsed || !Array.isArray(parsed.answers)) {
      throw new Error("AI grading payload invalid");
    }

    const byQuestion = new Map<string, QuizQuestionEvaluation>();

    for (const item of parsed.answers) {
      if (!item || typeof item.questionId !== "string") continue;
      const target = questions.find(({ question }) => question.id === item.questionId);
      if (!target) continue;

      const marks = Number(item.awardedMarks);
      const maxMarks = getQuestionMarks(target.question);
      const cappedMarks = Number.isFinite(marks)
        ? clampNumber(marks, 0, maxMarks)
        : 0;

      byQuestion.set(item.questionId, {
        questionId: item.questionId,
        isCorrect: Boolean(item.isCorrect),
        awardedMarks: Number(cappedMarks.toFixed(2)),
        gradingConfidence: clampNumber(Number(item.gradingConfidence) || 0.7, 0.01, 1),
        feedback: (item.feedback || "").trim() || "Answer reviewed.",
        correction: typeof item.correction === "string" ? item.correction.trim() || null : null,
        source: "ai",
      });
    }

    const evaluations = questions.map(({ question, answerText }) =>
      byQuestion.get(question.id) ?? buildOpenEndedFallbackGrade(question, answerText)
    );

    return {
      evaluations,
      summary: {
        feedbackSummary: (parsed.feedbackSummary || "").trim(),
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths.filter(Boolean).slice(0, 6) : [],
        weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.filter(Boolean).slice(0, 6) : [],
        improvementAreas: Array.isArray(parsed.improvementAreas)
          ? parsed.improvementAreas.filter(Boolean).slice(0, 6)
          : [],
      },
      raw: parsed as unknown as Record<string, unknown>,
    };
  } catch (err) {
    logger.warn("[quiz] open-ended AI grading failed, using fallback", {
      message: err instanceof Error ? err.message : String(err),
      questionCount: questions.length,
    });

    return {
      evaluations: fallbackEvaluations,
      summary: null,
      raw: {
        source: "fallback",
      },
    };
  }
}

function buildResultSummary(
  evaluations: QuizQuestionEvaluation[],
  questions: QuizQuestion[],
  aiSummary: Omit<GradingPayload, "score" | "totalMarks" | "percentage" | "answers"> | null
) {
  if (aiSummary && aiSummary.feedbackSummary) {
    return {
      feedbackSummary: aiSummary.feedbackSummary,
      strengths: aiSummary.strengths,
      weaknesses: aiSummary.weaknesses,
      improvementAreas: aiSummary.improvementAreas,
    };
  }

  const correct = evaluations.filter((row) => row.isCorrect).length;
  const total = questions.length;
  const wrong = Math.max(0, total - correct);

  const strengths = correct > 0
    ? [`Correctly solved ${correct} out of ${total} questions.`]
    : ["Completion noted. Keep practicing with guided steps."];

  const weaknesses = wrong > 0
    ? [`${wrong} questions need improvement in accuracy or method.`]
    : ["No major weak area detected in this attempt."];

  return {
    feedbackSummary: `You answered ${correct}/${total} questions correctly.`,
    strengths,
    weaknesses,
    improvementAreas: [
      "Review missed questions and re-attempt similar problems.",
      "Explain each step clearly before finalizing answers.",
    ],
  };
}

async function updateUserMasteryFromAttempt(
  userId: string,
  quiz: Quiz,
  attempt: QuizAttempt
): Promise<void> {
  const db = getSupabaseAdmin();

  const subjectId = quiz.subject_id ?? null;
  const topicId = quiz.topic_id ?? null;
  const level = quiz.level ?? null;

  const { data: existing } = await db
    .from("user_topic_mastery")
    .select("*")
    .eq("user_id", userId)
    .eq("subject_id", subjectId)
    .eq("topic_id", topicId)
    .eq("level", level)
    .single();

  const now = nowISO();
  const currentAverage = Number(existing?.average_score ?? 0);
  const currentTaken = Number(existing?.quizzes_taken ?? 0);
  const nextTaken = currentTaken + 1;
  const nextAverage = nextTaken > 0
    ? ((currentAverage * currentTaken) + Number(attempt.percentage)) / nextTaken
    : Number(attempt.percentage);
  const mastery = clampNumber(nextAverage, 0, 100);

  const row = {
    id: existing?.id ?? generateId(),
    user_id: userId,
    subject_id: subjectId,
    topic_id: topicId,
    level,
    mastery_score: Number(mastery.toFixed(2)),
    quizzes_taken: nextTaken,
    average_score: Number(nextAverage.toFixed(2)),
    last_quiz_at: now,
    metadata: {
      last_attempt_id: attempt.id,
      last_quiz_id: attempt.quiz_id,
    },
    updated_at: now,
  };

  const { error } = await db
    .from("user_topic_mastery")
    .upsert(row, { onConflict: "user_id,subject_id,topic_id,level" });

  if (error) {
    logger.warn("[quiz] failed to update mastery", { message: error.message, userId, quizId: quiz.id });
  }
}

export async function gradeQuizAttempt(userId: string, attemptId: string): Promise<AttemptResult> {
  const db = getSupabaseAdmin();
  const attempt = await getAttemptForUser(attemptId, userId);

  const { data: quiz } = await db
    .from("quizzes")
    .select("*")
    .eq("id", attempt.quiz_id)
    .eq("user_id", userId)
    .single();

  if (!quiz) throw new NotFoundError("Quiz");

  const { data: questions, error: questionError } = await db
    .from("quiz_questions")
    .select("*")
    .eq("quiz_id", attempt.quiz_id)
    .order("question_order", { ascending: true });

  if (questionError) throw new AppError(questionError.message, 500);

  const questionRows = (questions ?? []) as QuizQuestion[];
  if (questionRows.length === 0) throw new ValidationError("Quiz has no questions");

  const questionIds = questionRows.map((question) => question.id);
  const { data: answerRows, error: answerError } = await db
    .from("quiz_answers")
    .select("*")
    .eq("attempt_id", attempt.id)
    .in("question_id", questionIds);

  if (answerError) throw new AppError(answerError.message, 500);

  const answerMap = new Map<string, Record<string, unknown>>(
    (answerRows ?? []).map((answer) => [String((answer as Record<string, unknown>).question_id), answer as Record<string, unknown>])
  );

  const evaluations: QuizQuestionEvaluation[] = [];
  const openEndedToGrade: Array<{ question: QuizQuestion; answerText: string }> = [];

  for (const question of questionRows) {
    const answer = answerMap.get(question.id) ?? null;
    const responseText = getAnswerText(answer);

    if (!responseText.trim()) {
      evaluations.push({
        questionId: question.id,
        isCorrect: false,
        awardedMarks: 0,
        gradingConfidence: 0.99,
        feedback: "No answer submitted.",
        correction: typeof question.expected_answer?.value === "string"
          ? question.expected_answer.value
          : null,
        source: "deterministic",
      });
      continue;
    }

    const deterministic = evaluateDeterministic(question, answer);
    if (deterministic) {
      evaluations.push(deterministic);
      continue;
    }

    openEndedToGrade.push({ question, answerText: responseText });
  }

  const subjectName = await (async () => {
    if (!quiz.subject_id) return "General";
    const { data } = await db
      .from("subjects")
      .select("name")
      .eq("id", quiz.subject_id)
      .single();
    return data?.name ?? "General";
  })();

  const topicName = await (async () => {
    if (!quiz.topic_id) return "General Topic";
    const { data } = await db
      .from("topics")
      .select("name")
      .eq("id", quiz.topic_id)
      .single();
    return data?.name ?? "General Topic";
  })();

  const openEndedResult = await gradeOpenEndedWithAI(
    {
      subjectName,
      topicName,
      level: quiz.level,
      quizTitle: quiz.title,
    },
    openEndedToGrade
  );

  evaluations.push(...openEndedResult.evaluations);

  const lockedZeroQuestionIds = getLockedZeroQuestionIds(attempt);
  const finalEvaluations = evaluations.map((evaluation) => {
    if (!lockedZeroQuestionIds.has(evaluation.questionId) || evaluation.awardedMarks <= 0) {
      return evaluation;
    }
    return {
      ...evaluation,
      isCorrect: false,
      awardedMarks: 0,
      feedback: "Correct now, but this question scores 0 because an earlier attempt was incorrect.",
    };
  });

  const evaluationMap = new Map<string, QuizQuestionEvaluation>(
    finalEvaluations.map((evaluation) => [evaluation.questionId, evaluation])
  );

  const totalMarks = questionRows.reduce((sum, question) => sum + getQuestionMarks(question), 0);
  const score = questionRows.reduce((sum, question) => {
    const awarded = evaluationMap.get(question.id)?.awardedMarks ?? 0;
    return sum + awarded;
  }, 0);
  const percentage = totalMarks > 0 ? (score / totalMarks) * 100 : 0;

  const summary = buildResultSummary(finalEvaluations, questionRows, openEndedResult.summary);

  const now = nowISO();

  const updateRows = questionRows.map((question) => {
    const evaluation = evaluationMap.get(question.id)!;
    const existing = answerMap.get(question.id) ?? null;

    return {
      id: (existing?.id as string | undefined) ?? generateId(),
      attempt_id: attempt.id,
      question_id: question.id,
      answer_text: (existing?.answer_text as string | null | undefined) ?? null,
      answer_json: (existing?.answer_json as Record<string, unknown> | undefined) ?? {},
      answer_upload_id: (existing?.answer_upload_id as string | null | undefined) ?? null,
      extracted_text: (existing?.extracted_text as string | null | undefined) ?? null,
      extraction_confidence: (existing?.extraction_confidence as number | null | undefined) ?? null,
      grading_confidence: evaluation.gradingConfidence,
      is_correct: evaluation.isCorrect,
      awarded_marks: evaluation.awardedMarks,
      ai_feedback: evaluation.feedback,
      correction: evaluation.correction,
      review_required:
        evaluation.gradingConfidence < 0.55 ||
        ((existing?.extraction_confidence as number | null | undefined) ?? 1) < 0.55,
      created_at: (existing?.created_at as string | undefined) ?? now,
      updated_at: now,
    };
  });

  const { error: upsertError } = await db
    .from("quiz_answers")
    .upsert(updateRows, { onConflict: "attempt_id,question_id" });

  if (upsertError) throw new AppError(upsertError.message, 500);

  const { data: updatedAttempt, error: attemptUpdateError } = await db
    .from("quiz_attempts")
    .update({
      status: "graded",
      submitted_at: attempt.submitted_at ?? now,
      graded_at: now,
      score: Number(score.toFixed(2)),
      total_marks: Number(totalMarks.toFixed(2)),
      percentage: Number(percentage.toFixed(2)),
      feedback_summary: summary.feedbackSummary,
      strengths: summary.strengths,
      weaknesses: summary.weaknesses,
      improvement_areas: summary.improvementAreas,
      ai_evaluation: {
        summary,
        openEndedRaw: openEndedResult.raw,
      },
      ai_model: env.GEMINI_MODEL,
      ai_provider: "google",
      ai_version: "v1",
      updated_at: now,
    })
    .eq("id", attempt.id)
    .eq("user_id", userId)
    .select("*")
    .single();

  if (attemptUpdateError || !updatedAttempt) {
    throw new AppError(attemptUpdateError?.message ?? "Failed to update attempt grading", 500);
  }

  await updateUserMasteryFromAttempt(userId, quiz as Quiz, updatedAttempt as QuizAttempt);

  const refreshed = await getQuizAttemptResult(userId, attempt.id);
  if (!refreshed) throw new AppError("Failed to load graded attempt result", 500);
  return refreshed;
}

export async function getQuizAttemptResult(userId: string, attemptId: string): Promise<AttemptResult | null> {
  const db = getSupabaseAdmin();

  const { data: attempt, error: attemptError } = await db
    .from("quiz_attempts")
    .select("*")
    .eq("id", attemptId)
    .eq("user_id", userId)
    .single();

  if (attemptError || !attempt) return null;

  const { data: quiz } = await db
    .from("quizzes")
    .select("*")
    .eq("id", attempt.quiz_id)
    .eq("user_id", userId)
    .single();

  if (!quiz) throw new NotFoundError("Quiz");

  const { data: questions, error: questionError } = await db
    .from("quiz_questions")
    .select("*")
    .eq("quiz_id", attempt.quiz_id)
    .order("question_order", { ascending: true });

  if (questionError) throw new AppError(questionError.message, 500);

  const questionRows = (questions ?? []) as QuizQuestion[];
  const questionMap = new Map(questionRows.map((question) => [question.id, question]));

  const { data: answers, error: answerError } = await db
    .from("quiz_answers")
    .select("*")
    .eq("attempt_id", attempt.id);

  if (answerError) throw new AppError(answerError.message, 500);

  const enrichedAnswers = (answers ?? []).map((answer) => {
    const question = questionMap.get(String((answer as Record<string, unknown>).question_id));
    return {
      ...(answer as Record<string, unknown>),
      question_order: question?.question_order ?? null,
      question_text: question?.question_text ?? null,
      question_type: question?.question_type ?? null,
      question_marks: question?.marks ?? null,
      question_explanation: question?.explanation ?? null,
    };
  });

  return {
    attempt: attempt as QuizAttempt,
    quiz: quiz as Quiz,
    questions: questionRows,
    answers: enrichedAnswers,
  };
}

export async function getUserMastery(userId: string, targetUserId: string) {
  if (targetUserId !== userId) {
    throw new ForbiddenError("Cannot access mastery for another user");
  }

  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("user_topic_mastery")
    .select("*, subjects(name), topics(name)")
    .eq("user_id", targetUserId)
    .order("updated_at", { ascending: false });

  if (error) throw new AppError(error.message, 500);

  return (data ?? []).map((row) => {
    const subject = (row as Record<string, unknown>).subjects as Record<string, unknown> | null;
    const topic = (row as Record<string, unknown>).topics as Record<string, unknown> | null;

    return {
      ...row,
      subject_name: subject?.name ?? null,
      topic_name: topic?.name ?? null,
    };
  });
}
