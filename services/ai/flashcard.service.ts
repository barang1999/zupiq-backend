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

// ─── Deck management ──────────────────────────────────────────────────────────

export async function createDeck(userId: string, dto: CreateDeckDTO): Promise<FlashcardDeck> {
  const db = getSupabaseAdmin();
  const id = generateId();

  const { error } = await db.from("flashcard_decks").insert({
    id,
    user_id: userId,
    lesson_id: dto.lesson_id ?? null,
    title: dto.title,
    description: dto.description ?? null,
    subject: dto.subject ?? null,
    created_at: nowISO(),
    updated_at: nowISO(),
  });

  if (error) throw new AppError(error.message, 500);

  return getDeckById(id).then((d) => d!);
}

export async function getDeckById(id: string): Promise<FlashcardDeck | null> {
  const db = getSupabaseAdmin();

  const { data: deck, error } = await db
    .from("flashcard_decks")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !deck) return null;

  const { count } = await db
    .from("flashcards")
    .select("id", { count: "exact", head: true })
    .eq("deck_id", id);

  return { ...(deck as FlashcardDeck), card_count: count ?? 0 };
}

export async function getUserDecks(userId: string): Promise<FlashcardDeck[]> {
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("flashcard_decks")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw new AppError(error.message, 500);

  const decks = (data ?? []) as FlashcardDeck[];
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

  const prompt = `You are an expert educator. Generate exactly ${count} flashcards from the following educational content.

Content:
"""
${dto.content.slice(0, 8000)}
"""

Subject: ${dto.subject ?? "General"}
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
  const deckTitle = dto.deck_title ?? `AI-Generated: ${dto.subject ?? "Study"} Deck`;
  const deck = await createDeck(userId, {
    title: deckTitle,
    subject: dto.subject,
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
