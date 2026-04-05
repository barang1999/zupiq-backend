import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { aiRateLimit } from "../middlewares/rateLimit.middleware.js";
import { ValidationError, NotFoundError } from "../middlewares/error.middleware.js";
import {
  attachAnswerImageToQuestion,
  getQuizAttemptResult,
  gradeQuizAttempt,
  saveAttemptAnswer,
  submitQuizAttempt,
  validateAttemptAnswer,
} from "../../services/quiz.service.js";
import type { SaveQuizAnswerDTO, ValidateQuizAnswerDTO } from "../../models/quiz.model.js";

const router = Router();
router.use(requireAuth);

// POST /api/quiz-attempts/:attemptId/answers
router.post("/:attemptId/answers", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = req.body as SaveQuizAnswerDTO;
    if (!dto.questionId) throw new ValidationError("questionId is required");
    const answer = await saveAttemptAnswer(req.user!.sub, req.params.attemptId, dto);
    res.status(201).json({ answer });
  } catch (err) {
    next(err);
  }
});

// POST /api/quiz-attempts/:attemptId/answers/:questionId/image
router.post("/:attemptId/answers/:questionId/image", aiRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const uploadId = String(req.body.uploadId ?? req.body.upload_id ?? "").trim();
    if (!uploadId) throw new ValidationError("uploadId is required");

    const result = await attachAnswerImageToQuestion(
      req.user!.sub,
      req.params.attemptId,
      req.params.questionId,
      uploadId
    );

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/quiz-attempts/:attemptId/submit
router.post("/:attemptId/submit", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const attempt = await submitQuizAttempt(req.user!.sub, req.params.attemptId);
    res.json({ attempt });
  } catch (err) {
    next(err);
  }
});

// POST /api/quiz-attempts/:attemptId/answers/validate
router.post("/:attemptId/answers/validate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = req.body as ValidateQuizAnswerDTO;
    if (!dto.questionId) throw new ValidationError("questionId is required");
    const evaluation = await validateAttemptAnswer(req.user!.sub, req.params.attemptId, dto);
    res.json({ evaluation });
  } catch (err) {
    next(err);
  }
});

// POST /api/quiz-attempts/:attemptId/grade
router.post("/:attemptId/grade", aiRateLimit, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await gradeQuizAttempt(req.user!.sub, req.params.attemptId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/quiz-attempts/:attemptId/result
router.get("/:attemptId/result", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getQuizAttemptResult(req.user!.sub, req.params.attemptId);
    if (!result) throw new NotFoundError("Quiz attempt result");
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
