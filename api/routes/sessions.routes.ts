import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { ValidationError, NotFoundError } from "../middlewares/error.middleware.js";
import { createSession, getUserSessions, getSessionById, updateSession, deleteSession } from "../../services/session.service.js";
import type { CreateSessionDTO, UpdateSessionDTO } from "../../models/session.model.js";
import { publishCollabEvent } from "../../services/collab-stream.js";
import { logActivity, getSessionActivity } from "../../services/activity-log.service.js";
import { upsertBreakdownFeedback, deleteBreakdownFeedback, getBreakdownFeedback } from "../../services/feedback.service.js";

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
    logActivity(session.id, req.user!.sub, "session_created", {
      title: session.title,
      subject: session.subject,
    });
    res.status(201).json({ session });
  } catch (err) {
    next(err);
  }
});

// PUT /api/sessions/:id
router.put("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = req.body as UpdateSessionDTO;

    // Capture before-snapshot for human-readable fields only
    const SNAPSHOT_FIELDS = ['title', 'subject', 'problem', 'node_count'] as const;
    const changedFields = Object.keys(dto);
    const snapshotKeys = changedFields.filter((f) => (SNAPSHOT_FIELDS as readonly string[]).includes(f));

    const beforeSnapshot: Record<string, unknown> = {};
    if (snapshotKeys.length > 0) {
      const existing = await getSessionById(req.params.id, req.user!.sub);
      if (existing) {
        const snap = { title: existing.title, subject: existing.subject, problem: existing.problem, node_count: existing.node_count };
        for (const key of snapshotKeys) {
          beforeSnapshot[key] = snap[key as keyof typeof snap];
        }
      }
    }

    const session = await updateSession(req.params.id, req.user!.sub, dto);

    const afterSnapshot: Record<string, unknown> = {};
    const afterSnap = { title: session.title, subject: session.subject, problem: session.problem, node_count: session.node_count };
    for (const key of snapshotKeys) {
      afterSnapshot[key] = afterSnap[key as keyof typeof afterSnap];
    }

    // Notify collaborators that the session has been updated
    publishCollabEvent(req.params.id, "session_updated", { updatedBy: req.user!.sub });
    logActivity(req.params.id, req.user!.sub, "session_updated", {
      fields: changedFields,
      ...(snapshotKeys.length > 0 && { before: beforeSnapshot, after: afterSnapshot }),
    });
    res.json({ session });
  } catch (err) {
    next(err);
  }
});

// GET /api/sessions
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 15;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const sessions = await getUserSessions(req.user!.sub, limit, offset);
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

// DELETE /api/sessions/:id
router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteSession(req.params.id, req.user!.sub);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── Breakdown Feedback ───────────────────────────────────────────────────────

// GET /api/sessions/:id/feedback — returns the caller's current signal or null
router.get("/:id/feedback", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const signal = await getBreakdownFeedback(req.params.id, req.user!.sub);
    res.json({ signal });
  } catch (err) {
    next(err);
  }
});

// POST /api/sessions/:id/feedback — upsert a signal ('positive' | 'negative')
// Optional body field: reasons (string[]) — dislike reasons, only stored when signal is 'negative'.
router.post("/:id/feedback", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { signal, reasons } = req.body as { signal: unknown; reasons?: unknown };
    if (signal !== "positive" && signal !== "negative") {
      throw new ValidationError("signal must be 'positive' or 'negative'");
    }
    const validReasons = Array.isArray(reasons)
      ? reasons.filter((r): r is string => typeof r === "string").slice(0, 10)
      : undefined;
    await upsertBreakdownFeedback(req.params.id, req.user!.sub, signal, validReasons);
    res.json({ signal });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/sessions/:id/feedback — remove the caller's signal (un-rate)
router.delete("/:id/feedback", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteBreakdownFeedback(req.params.id, req.user!.sub);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
