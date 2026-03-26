import { Router, Request, Response, NextFunction } from "express";
import {
  createDeck,
  getDeckById,
  getUserDecks,
  deleteDeck,
  addCard,
  getDeckCards,
  getDueCards,
  reviewCard,
  generateFlashcardsFromContent,
} from "../../services/ai/flashcard.service.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { ValidationError, NotFoundError, ForbiddenError } from "../middlewares/error.middleware.js";
import type { CreateDeckDTO, CreateFlashcardDTO, ReviewFlashcardDTO, GenerateFlashcardsDTO } from "../../models/flashcard.model.js";

const router = Router();
router.use(requireAuth);

// ─── Decks ────────────────────────────────────────────────────────────────────

// GET /api/flashcards/decks
router.get("/decks", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const decks = await getUserDecks(req.user!.sub);
    res.json({ decks });
  } catch (err) {
    next(err);
  }
});

// POST /api/flashcards/decks
router.post("/decks", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = req.body as CreateDeckDTO;
    if (!dto.title) throw new ValidationError("title is required");

    const deck = await createDeck(req.user!.sub, dto);
    res.status(201).json({ deck });
  } catch (err) {
    next(err);
  }
});

// GET /api/flashcards/decks/:id
router.get("/decks/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deck = await getDeckById(req.params.id);
    if (!deck) throw new NotFoundError("Flashcard deck");
    if (deck.user_id !== req.user!.sub) throw new ForbiddenError("Access denied");
    res.json({ deck });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/flashcards/decks/:id
router.delete("/decks/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteDeck(req.params.id, req.user!.sub);
    res.json({ message: "Deck deleted" });
  } catch (err) {
    next(err);
  }
});

// ─── Cards ────────────────────────────────────────────────────────────────────

// GET /api/flashcards/decks/:id/cards
router.get("/decks/:id/cards", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deck = await getDeckById(req.params.id);
    if (!deck) throw new NotFoundError("Flashcard deck");
    if (deck.user_id !== req.user!.sub) throw new ForbiddenError("Access denied");

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const cards = await getDeckCards(req.params.id, { page, limit });
    res.json({ cards });
  } catch (err) {
    next(err);
  }
});

// GET /api/flashcards/decks/:id/due
router.get("/decks/:id/due", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deck = await getDeckById(req.params.id);
    if (!deck) throw new NotFoundError("Flashcard deck");
    if (deck.user_id !== req.user!.sub) throw new ForbiddenError("Access denied");

    const cards = await getDueCards(req.params.id);
    res.json({ cards, due_count: cards.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/flashcards/decks/:id/cards
router.post("/decks/:id/cards", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const deck = await getDeckById(req.params.id);
    if (!deck) throw new NotFoundError("Flashcard deck");
    if (deck.user_id !== req.user!.sub) throw new ForbiddenError("Access denied");

    const dto = req.body as CreateFlashcardDTO;
    if (!dto.front || !dto.back) throw new ValidationError("front and back are required");

    const card = await addCard(req.params.id, dto);
    res.status(201).json({ card });
  } catch (err) {
    next(err);
  }
});

// ─── Review ───────────────────────────────────────────────────────────────────

// POST /api/flashcards/review
router.post("/review", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = req.body as ReviewFlashcardDTO;
    if (!dto.deck_id || !dto.card_id || dto.rating === undefined) {
      throw new ValidationError("deck_id, card_id, and rating are required");
    }

    const deck = await getDeckById(dto.deck_id);
    if (!deck) throw new NotFoundError("Flashcard deck");
    if (deck.user_id !== req.user!.sub) throw new ForbiddenError("Access denied");

    const card = await reviewCard(dto);
    res.json({ card });
  } catch (err) {
    next(err);
  }
});

// ─── AI Generation ────────────────────────────────────────────────────────────

// POST /api/flashcards/generate
router.post("/generate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = req.body as GenerateFlashcardsDTO;
    if (!dto.content) throw new ValidationError("content is required");

    const deck = await generateFlashcardsFromContent(req.user!.sub, dto);
    res.status(201).json({ deck, message: `Generated ${deck.card_count} flashcards` });
  } catch (err) {
    next(err);
  }
});

export default router;
