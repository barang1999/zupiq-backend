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
import { generateId, nowISO, addDays, getPaginationOffset } from "../../utils/helpers.js";
import { NotFoundError, ForbiddenError, AppError } from "../../api/middlewares/error.middleware.js";
import { logger } from "../../utils/logger.js";
import { resolveOrCreateSubjectId } from "../session.service.js";

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
  const { subjectId, subjectName } = await resolveDeckSubject(dto);
  const fallbackSubjectName = String(dto.subject ?? "").trim();
  const resolvedSubjectName = (subjectName ?? fallbackSubjectName) || "General";

  const prompt = `You are an expert educator. Generate exactly ${count} flashcards from the following educational content.

Content:
"""
${dto.content.slice(0, 8000)}
"""

Subject: ${resolvedSubjectName}
Difficulty: ${dto.difficulty ?? "medium"}

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
- Add hints for harder concepts`;

  let rawText = "";
  try {
    const response = await client.models.generateContent({
      model: env.GEMINI_MODEL,
      config: { temperature: 0.3, maxOutputTokens: 4096 },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    rawText = response.text ?? "";
  } catch (err) {
    logger.error("Gemini flashcard generation error:", err);
    throw new AppError("AI service failed to generate flashcards", 502);
  }

  // Parse JSON from response
  let cards: Array<{ front: string; back: string; hint?: string }> = [];
  try {
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found in response");
    cards = JSON.parse(jsonMatch[0]);
  } catch (err) {
    logger.error("Failed to parse flashcard JSON:", rawText.slice(0, 500));
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
