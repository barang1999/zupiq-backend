import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { ValidationError } from "../middlewares/error.middleware.js";
import { createPost } from "../../services/post.service.js";
import { createResource, getResourceFeed, getResourceById, incrementDownload } from "../../services/resource.service.js";

const router = Router();
router.use(requireAuth);

// POST /api/resources — create resource + its post
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, description, file_url, file_type, tags, topic, grade } = req.body;
    if (!title) throw new ValidationError("title is required");

    // Create public post first
    const post = await createPost(req.user!.sub, { type: "resource", visibility: "public", topic, grade });
    // Then create resource linked to post
    const resource = await createResource(req.user!.sub, post.id, { title, description, file_url, file_type, tags, topic, grade });
    res.status(201).json({ resource, post });
  } catch (err) { next(err); }
});

// GET /api/resources — resource feed
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cursor, topic } = req.query as Record<string, string>;
    const items = await getResourceFeed({ cursor, topic });
    res.json({ items, nextCursor: items[items.length - 1]?.created_at ?? null });
  } catch (err) { next(err); }
});

// GET /api/resources/:id
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const resource = await getResourceById(req.params.id);
    if (!resource) return res.status(404).json({ error: "Resource not found" });
    res.json({ resource });
  } catch (err) { next(err); }
});

// POST /api/resources/:id/download
router.post("/:id/download", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const url = await incrementDownload(req.params.id);
    res.json({ url });
  } catch (err) { next(err); }
});

export default router;
