import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { ValidationError } from "../middlewares/error.middleware.js";
import {
  createKnowledgeRecord,
  listKnowledgeRecords,
  deleteKnowledgeRecord,
  type CreateKnowledgeRecordInput,
  type KnowledgeContentType,
} from "../../services/knowledge.service.js";

const router = Router();
router.use(requireAuth);

const VALID_CONTENT_TYPES: KnowledgeContentType[] = [
  "insight",
  "visual_table",
  "conversation_message",
  "node_breakdown",
];

// ─── POST /api/knowledge ──────────────────────────────────────────────────────
// Save a new knowledge record

router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { title, content_type, subject, node_label, content, summary, tags } = req.body;

      if (!title || typeof title !== "string" || !title.trim()) {
        throw new ValidationError("title is required");
      }
      if (!content_type || !VALID_CONTENT_TYPES.includes(content_type as KnowledgeContentType)) {
        throw new ValidationError(
          `content_type must be one of: ${VALID_CONTENT_TYPES.join(", ")}`
        );
      }
      if (!content || typeof content !== "object" || Array.isArray(content)) {
        throw new ValidationError("content must be a non-null object");
      }

      const input: CreateKnowledgeRecordInput = {
        title: title.trim().slice(0, 255),
        content_type: content_type as KnowledgeContentType,
        subject: typeof subject === "string" && subject.trim() ? subject.trim() : null,
        node_label: typeof node_label === "string" && node_label.trim() ? node_label.trim() : null,
        content: content as Record<string, unknown>,
        summary:
          typeof summary === "string" && summary.trim()
            ? summary.trim().slice(0, 500)
            : null,
        tags: Array.isArray(tags)
          ? tags.filter((t): t is string => typeof t === "string").slice(0, 10)
          : [],
      };

      const record = await createKnowledgeRecord(req.user!.sub, input);
      res.status(201).json({ record });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/knowledge ───────────────────────────────────────────────────────
// List the user's knowledge records (optionally filtered by subject)

router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const subject =
        typeof req.query.subject === "string" && req.query.subject.trim()
          ? req.query.subject.trim()
          : undefined;
      const rawLimit  = parseInt(String(req.query.limit  ?? "50"), 10);
      const rawOffset = parseInt(String(req.query.offset ?? "0"),  10);

      const { records, total } = await listKnowledgeRecords(req.user!.sub, {
        subject,
        limit:  Number.isFinite(rawLimit)  ? rawLimit  : 50,
        offset: Number.isFinite(rawOffset) ? rawOffset : 0,
      });

      res.json({ records, total });
    } catch (err) {
      next(err);
    }
  }
);

// ─── DELETE /api/knowledge/:id ────────────────────────────────────────────────
// Delete a knowledge record owned by the caller

router.delete(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      if (!id) throw new ValidationError("id is required");
      await deleteKnowledgeRecord(req.user!.sub, id);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
