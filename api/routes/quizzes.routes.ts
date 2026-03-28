import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { aiRateLimit } from "../middlewares/rateLimit.middleware.js";
import { NotFoundError, ValidationError } from "../middlewares/error.middleware.js";
import {
  createQuizAttempt,
  generateQuizForUser,
  getQuizForUser,
  listUserQuizzes,
} from "../../services/quiz.service.js";
import type { GenerateQuizDTO } from "../../models/quiz.model.js";

const router = Router();
router.use(requireAuth);

// GET /api/quizzes
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Number(req.query.limit ?? 10);
    const quizzes = await listUserQuizzes(req.user!.sub, Number.isFinite(limit) ? limit : 10);
    res.json({ quizzes });
  } catch (err) {
    next(err);
  }
});

// POST /api/quizzes/generate
router.post("/generate", aiRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = req.body as GenerateQuizDTO;
    const questionCount = Number(dto.questionCount ?? 8);
    if (!Number.isFinite(questionCount) || questionCount < 1) {
      throw new ValidationError("questionCount must be a positive number");
    }
    const quizBundle = await generateQuizForUser(req.user!.sub, dto);
    res.status(201).json({
      quizId: quizBundle.quiz.id,
      status: quizBundle.quiz.status,
      quiz: quizBundle.quiz,
      questions: quizBundle.questions,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/quizzes/:quizId
router.get("/:quizId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bundle = await getQuizForUser(req.user!.sub, req.params.quizId);
    if (!bundle) throw new NotFoundError("Quiz");
    res.json(bundle);
  } catch (err) {
    next(err);
  }
});

// POST /api/quizzes/:quizId/attempts
router.post("/:quizId/attempts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const attempt = await createQuizAttempt(req.user!.sub, req.params.quizId);
    res.status(201).json({ attemptId: attempt.id, attempt });
  } catch (err) {
    next(err);
  }
});

// GET /api/quizzes/:quizId/history
router.get("/:quizId/history", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bundle = await getQuizForUser(req.user!.sub, req.params.quizId);
    if (!bundle) throw new NotFoundError("Quiz");
    const quizzes = await listUserQuizzes(req.user!.sub, 30);
    const history = quizzes.filter((quiz) => quiz.id === req.params.quizId);
    res.json({ history });
  } catch (err) {
    next(err);
  }
});

export default router;
