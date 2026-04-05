import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env.js";
import { getSupabaseAdmin } from "../../config/supabase.js";
import {
  FlashcardDeck,
  Flashcard,
  CreateDeckDTO,
  CreateFlashcardDTO,
  GenerateFlashcardsDTO,
  ReviewFlashcardDTO,
} from "../../models/flashcard.model.js";
import { Language, SUPPORTED_LANGUAGES } from "../../models/user.model.js";
import { generateId, nowISO, addDays, getPaginationOffset } from "../../utils/helpers.js";
import { NotFoundError, ForbiddenError, AppError } from "../../api/middlewares/error.middleware.js";
import { logger } from "../../utils/logger.js";
import { getSessionById, resolveOrCreateSubjectId } from "../session.service.js";
import { LANGUAGE_NAMES } from "./core/system-instruction.js";

type DeckRow = {
  id: string;
  user_id: string;
  lesson_id: string | null;
  title: string;
  description: string | null;
  subject_id?: string | null;
  subject?: string | null; // legacy column support
  subjects?: { name?: string | null } | null;
  created_at: string;
  updated_at: string;
};

type GeneratedFlashcard = {
  front: string;
  back: string;
  hint?: string | null;
};

const SUPPORTED_LANGUAGE_SET = new Set<string>(SUPPORTED_LANGUAGES as readonly string[]);

function normalizeLanguage(value: string | null | undefined): Language {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (SUPPORTED_LANGUAGE_SET.has(normalized) ? normalized : "en") as Language;
}

async function resolveUserLanguage(userId: string): Promise<{ code: Language; name: string }> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("users")
    .select("language")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    logger.warn("[flashcards] failed to load user language, defaulting to English", {
      userId,
      message: error.message,
    });
  }

  const code = normalizeLanguage((data as { language?: string | null } | null)?.language ?? null);
  const name = LANGUAGE_NAMES[code] ?? "English";
  return { code, name };
}

function parseJsonLooseContent(raw: unknown): unknown {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const first = JSON.parse(raw);
      if (typeof first === "string" && (first.startsWith("{") || first.startsWith("["))) {
        return JSON.parse(first);
      }
      return first;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw;
  return null;
}

function getBreakdownNodes(rawBreakdown: unknown): Array<Record<string, unknown>> {
  const parsed = parseJsonLooseContent(rawBreakdown);
  if (Array.isArray(parsed)) return parsed.filter((n) => n && typeof n === "object") as Array<Record<string, unknown>>;
  if (parsed && typeof parsed === "object") {
    const root = parsed as Record<string, unknown>;
    const nestedNodes = (root.breakdown as Record<string, unknown> | undefined)?.nodes;
    const nodes: unknown[] = Array.isArray(root.nodes)
      ? root.nodes
      : Array.isArray(nestedNodes)
        ? (nestedNodes as unknown[])
        : [];
    return nodes.filter((n) => n && typeof n === "object") as Array<Record<string, unknown>>;
  }
  return [];
}

function isLikelyCodeOrMetadataLine(input: string): boolean {
  const line = input.trim();
  if (!line) return false;
  if (/\/zupiq-(backend|web|mobile)|\/(src|app|models|services)\//i.test(line)) return true;
  if (/\b[a-z0-9_-]+\/[a-z0-9_./-]+\.(ts|tsx|js|jsx|json|sql)\b/i.test(line)) return true;
  if (/^\s*(import|export|interface|type|class|function|const|let|var)\b/.test(line)) return true;
  if (/^\s*CREATE\s+TABLE\b|^\s*ALTER\s+TABLE\b|^\s*SELECT\s+/i.test(line)) return true;
  if (/^\s*\/\/|^\s*\/\*/.test(line)) return true;
  if (/[{};]{2,}/.test(line)) return true;
  return false;
}

function sanitizeEducationalContent(raw: string): string {
  const text = String(raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";

  const lines = text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const filtered = lines.filter((line) => !isLikelyCodeOrMetadataLine(line));
  const joinedFiltered = filtered.join("\n").trim();

  // If filtering was too aggressive, keep original text.
  if (joinedFiltered.length >= Math.min(120, Math.floor(text.length * 0.35))) {
    return joinedFiltered;
  }
  return text;
}

function buildSessionStudyContent(session: { title?: string | null; subject?: string | null; problem?: string | null; breakdown_json?: string | null }): string {
  const headerParts: string[] = [];
  if (session.subject) headerParts.push(`Subject: ${String(session.subject).trim()}`);
  if (session.title) headerParts.push(`Session title: ${String(session.title).trim()}`);
  if (session.problem) headerParts.push(`Problem: ${String(session.problem).trim()}`);

  const nodes = getBreakdownNodes(session.breakdown_json).slice(0, 30);
  const nodeSections = nodes
    .map((node, idx) => {
      const label = String(node.label ?? "").trim();
      const description = String(node.description ?? "").trim();
      const math = String(node.mathContent ?? node.keyFormula ?? "").trim();
      const parts = [
        label ? `${idx + 1}. ${label}` : `${idx + 1}. Key point`,
        description,
        math ? `Formula: ${math}` : "",
      ].filter(Boolean);
      return parts.join("\n");
    })
    .filter(Boolean);

  const content = [
    headerParts.join("\n"),
    nodeSections.length > 0 ? `Key concepts from the session:\n${nodeSections.join("\n\n")}` : "",
  ].filter(Boolean).join("\n\n");

  return sanitizeEducationalContent(content);
}

async function resolveGenerationSourceContent(
  userId: string,
  dto: GenerateFlashcardsDTO
): Promise<{ content: string; source: "session" | "payload"; subjectHint: string | null }> {
  const payloadContent = sanitizeEducationalContent(String(dto.content ?? ""));
  const sessionId = String(dto.session_id ?? "").trim();
  if (!sessionId) {
    return { content: payloadContent, source: "payload", subjectHint: null };
  }

  const session = await getSessionById(sessionId, userId).catch(() => null);
  if (!session) {
    logger.warn("[flashcards] session_id provided but session not found or not accessible", { userId, sessionId });
    return { content: payloadContent, source: "payload", subjectHint: null };
  }

  const sessionContent = buildSessionStudyContent(session);
  if (sessionContent.trim()) {
    return {
      content: sessionContent,
      source: "session",
      subjectHint: String(session.subject ?? "").trim() || null,
    };
  }

  return {
    content: payloadContent,
    source: "payload",
    subjectHint: String(session.subject ?? "").trim() || null,
  };
}

function isSoftwareSubject(subject: string): boolean {
  const s = String(subject ?? "").toLowerCase();
  return /\b(computer|programming|coding|software|cs|algorithm|data structure|javascript|typescript|python|java)\b/.test(s);
}

function stripCodeFence(text: string): string {
  return String(text ?? "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractFirstJsonValue(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start < 0) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
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
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
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
  return escapeInvalidBackslashesInsideJsonStrings(
    input
      .replace(/[\u0000-\u001F]/g, (ch) => {
        if (ch === "\n" || ch === "\r" || ch === "\t") return ch;
        return " ";
      })
      .replace(/,\s*([}\]])/g, "$1")
  );
}

function escapeInvalidBackslashesInsideJsonStrings(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (!inString) {
      out += ch;
      if (ch === "\"") inString = true;
      continue;
    }

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    // JSON does not allow literal newlines/tabs inside strings.
    if (ch === "\n") { out += "\\n"; continue; }
    if (ch === "\r") { out += "\\r"; continue; }
    if (ch === "\t") { out += "\\t"; continue; }

    if (ch === "\\") {
      const next = input[i + 1];
      const validEscape =
        next === "\"" ||
        next === "\\" ||
        next === "/" ||
        next === "n" ||
        next === "r" ||
        next === "t" ||
        next === "u";

      if (validEscape) {
        out += ch;
        escaped = true;
      } else {
        // Common for math content (\Delta, \frac, \times ...).
        out += "\\\\";
      }
      continue;
    }

    out += ch;
    if (ch === "\"") inString = false;
  }

  return out;
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

function normalizeGeneratedCards(rawCards: unknown, limit: number): GeneratedFlashcard[] {
  const source = Array.isArray(rawCards)
    ? rawCards
    : rawCards && typeof rawCards === "object"
      ? (
          (rawCards as Record<string, unknown>).cards ??
          (rawCards as Record<string, unknown>).flashcards ??
          (rawCards as Record<string, unknown>).items
        )
      : null;
  if (!Array.isArray(source)) return [];

  const normalized: GeneratedFlashcard[] = [];
  for (const raw of source) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const front = typeof item.front === "string" ? item.front.trim() : "";
    const back = typeof item.back === "string" ? item.back.trim() : "";
    const hint = item.hint == null ? null : String(item.hint).trim();
    if (!front || !back) continue;
    normalized.push({ front, back, hint: hint || null });
    if (normalized.length >= limit) break;
  }

  return normalized;
}

function recoverCardsFromPartialArray(raw: string, limit: number): GeneratedFlashcard[] {
  const text = stripCodeFence(raw || "");
  const start = text.indexOf("[");
  if (start < 0) return [];

  const cards: GeneratedFlashcard[] = [];
  let inString = false;
  let escaped = false;
  let objectStart = -1;
  let objectDepth = 0;

  for (let i = start + 1; i < text.length; i++) {
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
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (objectStart < 0) {
      if (ch === "{") {
        objectStart = i;
        objectDepth = 1;
      } else if (ch === "]") {
        break;
      }
      continue;
    }

    if (ch === "{") {
      objectDepth++;
      continue;
    }

    if (ch === "}") {
      objectDepth--;
      if (objectDepth === 0) {
        const candidate = text.slice(objectStart, i + 1);
        const parsed = parseJsonLoose<Record<string, unknown>>(candidate);
        const normalized = normalizeGeneratedCards(parsed ? [parsed] : [], 1);
        if (normalized.length > 0) cards.push(normalized[0]);
        objectStart = -1;
        if (cards.length >= limit) break;
      }
    }
  }

  return cards;
}

function parseGeneratedFlashcards(raw: string, requestedCount: number): GeneratedFlashcard[] {
  const parsed = parseJsonLoose<unknown>(raw);
  const normalized = normalizeGeneratedCards(parsed, requestedCount);
  if (normalized.length > 0) return normalized;
  return recoverCardsFromPartialArray(raw, requestedCount);
}

function normalizeDeckRow(row: DeckRow): FlashcardDeck {
  const joinedSubjectName = row.subjects?.name ?? null;
  const legacySubjectName = typeof row.subject === "string" ? row.subject : null;
  return {
    id: row.id,
    user_id: row.user_id,
    lesson_id: row.lesson_id ?? null,
    title: row.title,
    description: row.description ?? null,
    subject_id: row.subject_id ?? null,
    subject_name: joinedSubjectName ?? legacySubjectName,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getSubjectNameById(subjectId: string): Promise<string | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("subjects")
    .select("name")
    .eq("id", subjectId)
    .maybeSingle();
  if (error) throw new AppError(error.message, 500);
  return data?.name ? String(data.name) : null;
}

async function resolveDeckSubject(dto: Pick<CreateDeckDTO, "subject_id" | "subject">): Promise<{ subjectId: string | null; subjectName: string | null }> {
  if (dto.subject_id) {
    const subjectName = await getSubjectNameById(dto.subject_id);
    if (!subjectName) throw new AppError("Invalid subject_id", 400);
    return { subjectId: dto.subject_id, subjectName };
  }

  const rawSubject = String(dto.subject ?? "").trim();
  if (!rawSubject) return { subjectId: null, subjectName: null };

  const subjectId = await resolveOrCreateSubjectId(rawSubject);
  const subjectName = await getSubjectNameById(subjectId);
  return { subjectId, subjectName: subjectName ?? rawSubject };
}

// ─── Deck management ──────────────────────────────────────────────────────────

export async function createDeck(userId: string, dto: CreateDeckDTO): Promise<FlashcardDeck> {
  const db = getSupabaseAdmin();
  const id = generateId();
  const { subjectId, subjectName } = await resolveDeckSubject(dto);

  const { error } = await db.from("flashcard_decks").insert({
    id,
    user_id: userId,
    lesson_id: dto.lesson_id ?? null,
    title: dto.title,
    description: dto.description ?? null,
    subject_id: subjectId,
    created_at: nowISO(),
    updated_at: nowISO(),
  });

  if (error) {
    // Backward compatibility for environments where flashcard_decks.subject_id has not been added yet.
    if (error.message.includes("subject_id") && error.message.includes("does not exist")) {
      const { error: legacyError } = await db.from("flashcard_decks").insert({
        id,
        user_id: userId,
        lesson_id: dto.lesson_id ?? null,
        title: dto.title,
        description: dto.description ?? null,
        subject: subjectName ?? null,
        created_at: nowISO(),
        updated_at: nowISO(),
      });
      if (legacyError) throw new AppError(legacyError.message, 500);
      return getDeckById(id).then((d) => d!);
    }
    throw new AppError(error.message, 500);
  }

  return getDeckById(id).then((d) => d!);
}

export async function getDeckById(id: string): Promise<FlashcardDeck | null> {
  const db = getSupabaseAdmin();
  let deck: DeckRow | null = null;

  const { data: modernDeck, error: modernError } = await db
    .from("flashcard_decks")
    .select("*, subjects(name)")
    .eq("id", id)
    .maybeSingle();

  if (modernError) {
    const { data: legacyDeck, error: legacyError } = await db
      .from("flashcard_decks")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (legacyError) throw new AppError(legacyError.message, 500);
    if (!legacyDeck) return null;
    deck = legacyDeck as DeckRow;
  } else {
    if (!modernDeck) return null;
    deck = modernDeck as DeckRow;
  }

  const { count } = await db
    .from("flashcards")
    .select("id", { count: "exact", head: true })
    .eq("deck_id", id);

  return { ...normalizeDeckRow(deck), card_count: count ?? 0 };
}

export async function getUserDecks(userId: string): Promise<FlashcardDeck[]> {
  const db = getSupabaseAdmin();
  let decks: FlashcardDeck[] = [];
  const { data: modernData, error: modernError } = await db
    .from("flashcard_decks")
    .select("*, subjects(name)")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (modernError) {
    const { data: legacyData, error: legacyError } = await db
      .from("flashcard_decks")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (legacyError) throw new AppError(legacyError.message, 500);
    decks = ((legacyData ?? []) as DeckRow[]).map((row) => normalizeDeckRow(row));
  } else {
    decks = ((modernData ?? []) as DeckRow[]).map((row) => normalizeDeckRow(row));
  }

  if (decks.length === 0) return [];

  const deckIds = decks.map((d) => d.id);

  const { data: cards } = await db
    .from("flashcards")
    .select("deck_id")
    .in("deck_id", deckIds);

  const countMap: Record<string, number> = {};
  for (const row of cards ?? []) {
    countMap[row.deck_id] = (countMap[row.deck_id] ?? 0) + 1;
  }

  return decks.map((d) => ({ ...d, card_count: countMap[d.id] ?? 0 }));
}

export async function deleteDeck(id: string, userId: string): Promise<void> {
  const deck = await getDeckById(id);
  if (!deck) throw new NotFoundError("Flashcard deck");
  if (deck.user_id !== userId) throw new ForbiddenError("Cannot delete this deck");

  const db = getSupabaseAdmin();

  const { error: cardsError } = await db.from("flashcards").delete().eq("deck_id", id);
  if (cardsError) throw new AppError(cardsError.message, 500);

  const { error } = await db.from("flashcard_decks").delete().eq("id", id);
  if (error) throw new AppError(error.message, 500);
}

// ─── Card management ──────────────────────────────────────────────────────────

export async function addCard(deckId: string, dto: CreateFlashcardDTO): Promise<Flashcard> {
  const db = getSupabaseAdmin();
  const id = generateId();

  const { error } = await db.from("flashcards").insert({
    id,
    deck_id: deckId,
    front: dto.front,
    back: dto.back,
    hint: dto.hint ?? null,
    difficulty: dto.difficulty ?? "medium",
    review_count: 0,
    created_at: nowISO(),
  });

  if (error) throw new AppError(error.message, 500);

  // Update deck's updated_at timestamp
  await db
    .from("flashcard_decks")
    .update({ updated_at: nowISO() })
    .eq("id", deckId);

  const { data: card, error: fetchError } = await db
    .from("flashcards")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !card) throw new AppError("Failed to create flashcard", 500);
  return card as Flashcard;
}

export async function getDeckCards(
  deckId: string,
  params: { page?: number; limit?: number } = {}
): Promise<Flashcard[]> {
  const db = getSupabaseAdmin();
  const { offset, limit } = getPaginationOffset(params);

  const { data, error } = await db
    .from("flashcards")
    .select("*")
    .eq("deck_id", deckId)
    .order("created_at", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) throw new AppError(error.message, 500);
  return (data ?? []) as Flashcard[];
}

export async function getDueCards(deckId: string): Promise<Flashcard[]> {
  const db = getSupabaseAdmin();
  const now = nowISO();

  // Get cards with no next_review_at or where next_review_at <= now
  const { data, error } = await db
    .from("flashcards")
    .select("*")
    .eq("deck_id", deckId)
    .or(`next_review_at.is.null,next_review_at.lte.${now}`)
    .order("next_review_at", { ascending: true, nullsFirst: true });

  if (error) throw new AppError(error.message, 500);
  return (data ?? []) as Flashcard[];
}

// ─── Review / Spaced Repetition (simplified SM-2) ────────────────────────────

export async function reviewCard(dto: ReviewFlashcardDTO): Promise<Flashcard> {
  const db = getSupabaseAdmin();

  const { data: card, error: fetchError } = await db
    .from("flashcards")
    .select("*")
    .eq("id", dto.card_id)
    .single();

  if (fetchError || !card) throw new NotFoundError("Flashcard");

  const existingCard = card as Flashcard;

  // Simplified SM-2 algorithm
  let intervalDays = 1;
  if (dto.rating >= 4) {
    intervalDays = Math.max(1, (existingCard.review_count ?? 0) + 1) * 2;
  } else if (dto.rating === 3) {
    intervalDays = 1;
  } else {
    intervalDays = 0; // review again today
  }

  const nextReview = addDays(new Date(), intervalDays);

  const { data: updated, error } = await db
    .from("flashcards")
    .update({
      last_reviewed_at: nowISO(),
      next_review_at: nextReview.toISOString(),
      review_count: (existingCard.review_count ?? 0) + 1,
      difficulty: dto.rating >= 4 ? "easy" : dto.rating === 3 ? "medium" : "hard",
    })
    .eq("id", dto.card_id)
    .select()
    .single();

  if (error || !updated) throw new AppError("Failed to update flashcard review", 500);
  return updated as Flashcard;
}

// ─── AI-driven flashcard generation ──────────────────────────────────────────

export async function generateFlashcardsFromContent(
  userId: string,
  dto: GenerateFlashcardsDTO
): Promise<FlashcardDeck> {
  const client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const count = dto.count ?? 10;
  const source = await resolveGenerationSourceContent(userId, dto);
  const effectiveSubject = String(dto.subject ?? source.subjectHint ?? "").trim();
  const { subjectId, subjectName } = await resolveDeckSubject({ subject_id: dto.subject_id, subject: effectiveSubject });
  const fallbackSubjectName = effectiveSubject;
  const resolvedSubjectName = (subjectName ?? fallbackSubjectName) || "General";
  const userLanguage = await resolveUserLanguage(userId);
  const languageInstruction = userLanguage.code === "en"
    ? "Respond entirely in English."
    : `IMPORTANT: Respond entirely in ${userLanguage.name} (${userLanguage.code}).`;
  const softwareSubject = isSoftwareSubject(resolvedSubjectName);
  const generationContent = source.content.slice(0, 9000);

  if (!generationContent.trim()) {
    throw new AppError("Not enough educational content to generate flashcards", 400);
  }

  const basePrompt = `You are an expert educator. Generate exactly ${count} flashcards from the following educational content.

Content:
"""
${generationContent}
"""

Subject: ${resolvedSubjectName}
Difficulty: ${dto.difficulty ?? "medium"}
Target language: ${userLanguage.name} (${userLanguage.code})
Content source: ${source.source}

Respond ONLY with a valid JSON array. No markdown, no extra text, just JSON:
[
  {
    "front": "question or term",
    "back": "answer or definition",
    "hint": "optional helpful hint (or null)"
  }
]

Requirements:
- Create exactly ${count} cards
- Cover key concepts, definitions, formulas, and facts
- Make questions clear and specific
- Keep answers concise but complete
- Add hints for harder concepts
- Write front/back/hint in ${userLanguage.name} (${userLanguage.code})
- Keep formulas and symbols in standard math notation
- Focus on the actual lesson concepts, not metadata
- Ignore file paths, API routes, table schemas, JSON keys, timestamps, and app/source-code boilerplate unless the subject is explicitly software/programming (${softwareSubject ? "software subject detected" : "non-software subject"})`;

  let cards: GeneratedFlashcard[] = [];
  let lastRawText = "";
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const retrySuffix = attempt === 1
      ? ""
      : "\n\nIMPORTANT: Your previous response was invalid or incomplete JSON. Regenerate from scratch and return complete valid JSON only. Keep each back/hint concise.";
    const prompt = `${basePrompt}${retrySuffix}`;

    try {
      const response = await client.models.generateContent({
        model: env.GEMINI_MODEL,
        config: {
          systemInstruction: `You are Zupiq flashcard generator. ${languageInstruction} Never switch languages unless the user explicitly asks for translation.`,
          responseMimeType: "application/json",
          temperature: 0.25,
          maxOutputTokens: 8192,
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      const rawText = response.text ?? "";
      lastRawText = rawText;
      cards = parseGeneratedFlashcards(rawText, count);
      if (cards.length > 0) break;

      if (attempt < maxAttempts) {
        logger.warn(
          `[flashcards] parse failed (attempt ${attempt}/${maxAttempts}) - retrying. Length:`,
          rawText.length,
          "Raw:",
          rawText.slice(0, 500)
        );
      }
    } catch (err) {
      if (attempt >= maxAttempts) {
        logger.error("Gemini flashcard generation error:", err);
        throw new AppError("AI service failed to generate flashcards", 502);
      }
      logger.warn(
        `[flashcards] generation failed (attempt ${attempt}/${maxAttempts}) - retrying`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (cards.length === 0) {
    logger.error("Failed to parse flashcard JSON:", lastRawText.slice(0, 500));
    throw new AppError("Failed to parse AI-generated flashcards", 500);
  }

  // Create deck
  const deckTitle = dto.deck_title ?? `AI-Generated: ${resolvedSubjectName} Deck`;
  const deck = await createDeck(userId, {
    title: deckTitle,
    subject_id: subjectId ?? undefined,
    subject: resolvedSubjectName,
    lesson_id: dto.lesson_id,
    description: `Auto-generated from content on ${new Date().toLocaleDateString()}`,
  });

  // Insert cards
  for (const card of cards) {
    if (card.front && card.back) {
      await addCard(deck.id, {
        front: card.front,
        back: card.back,
        hint: card.hint ?? undefined,
        difficulty: dto.difficulty ?? "medium",
      });
    }
  }

  return getDeckById(deck.id).then((d) => d!);
}
