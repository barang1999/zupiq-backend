import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { ValidationError, NotFoundError } from "../middlewares/error.middleware.js";
import { createSession, getUserSessions, getSessionById, updateSession } from "../../services/session.service.js";
import type { CreateSessionDTO, UpdateSessionDTO } from "../../models/session.model.js";

const router = Router();
router.use(requireAuth);

// POST /api/sessions
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = req.body as CreateSessionDTO;
    if (!dto.title || !dto.problem || !dto.breakdown_json) {
      throw new ValidationError("title, problem, and breakdown_json are required");
    }
    const session = await createSession(req.user!.sub, dto);
    res.status(201).json({ session });
  } catch (err) {
    next(err);
  }
});

// PUT /api/sessions/:id
router.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = req.body as UpdateSessionDTO;
    const session = await updateSession(req.params.id, req.user!.sub, dto);
    res.json({ session });
  } catch (err) {
    next(err);
  }
});

// GET /api/sessions
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessions = await getUserSessions(req.user!.sub);
    res.json({ sessions });
  } catch (err) {
    next(err);
  }
});

// GET /api/sessions/:id
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await getSessionById(req.params.id, req.user!.sub);
    if (!session) throw new NotFoundError("Session");
    res.json({ session });
  } catch (err) {
    next(err);
  }
});

export default router;
