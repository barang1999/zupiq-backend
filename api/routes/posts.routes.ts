import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { ValidationError } from "../middlewares/error.middleware.js";
import { createPost, deletePost, getPostById, getForYouFeed, getFollowingFeed, getMyPosts, getSavedPosts, getUserPosts, logInteraction } from "../../services/post.service.js";
import type { InteractionEventType } from "../../services/post.service.js";
import { likePost, unlikePost, savePost, unsavePost } from "../../services/social.service.js";
import { getComments, createComment, deleteComment } from "../../services/comment.service.js";

const router = Router();
router.use(requireAuth);

// POST /api/posts — share a session
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { session_id, collection_id, type, visibility, topic, grade, caption, image_url, image_ocr_text, file_url, file_name } = req.body;
    if (!type) throw new ValidationError("type is required");
    const post = await createPost(req.user!.sub, { session_id, collection_id, type, visibility, topic, grade, caption, image_url, image_ocr_text, file_url, file_name });
    res.status(201).json({ post });
  } catch (err) { next(err); }
});

// GET /api/posts/feed — For You feed
router.get("/feed", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cursor, topic } = req.query as Record<string, string>;
    const items = await getForYouFeed(req.user!.sub, { cursor, topic });
    const nextCursor = items.length
      ? items.reduce((oldest, item) => item.created_at < oldest ? item.created_at : oldest, items[0].created_at)
      : null;
    res.json({ items, nextCursor });
  } catch (err) { next(err); }
});

// GET /api/posts/following — Following feed
router.get("/following", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cursor } = req.query as Record<string, string>;
    const items = await getFollowingFeed(req.user!.sub, { cursor });
    res.json({ items, nextCursor: items[items.length - 1]?.created_at ?? null });
  } catch (err) { next(err); }
});

// GET /api/posts/saved — My saved posts
router.get("/saved", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cursor, type } = req.query as Record<string, string>;
    const items = await getSavedPosts(req.user!.sub, { cursor, type });
    res.json({ items, nextCursor: items[items.length - 1]?.created_at ?? null });
  } catch (err) { next(err); }
});

// GET /api/posts/mine — current user's posts, newest first
router.get("/mine", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cursor } = req.query as Record<string, string>;
    const items = await getMyPosts(req.user!.sub, { cursor, limit: 10 });
    res.json({
      items,
      nextCursor: items.length === 10 ? items[items.length - 1]?.created_at ?? null : null,
    });
  } catch (err) { next(err); }
});

// GET /api/posts/user/:userId — posts visible to the current viewer
router.get("/user/:userId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cursor } = req.query as Record<string, string>;
    const items = await getUserPosts(req.params.userId, req.user!.sub, { cursor, limit: 10 });
    res.json({
      items,
      nextCursor: items.length === 10 ? items[items.length - 1]?.created_at ?? null : null,
    });
  } catch (err) { next(err); }
});

// GET /api/posts/:id
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const post = await getPostById(req.params.id, req.user!.sub);
    if (!post) return res.status(404).json({ error: "Post not found" });
    res.json({ post });
  } catch (err) { next(err); }
});

// POST /api/posts/:id/interact — log a view/share event (fire-and-forget from client)
router.post("/:id/interact", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { event_type, duration_ms } = req.body as { event_type: InteractionEventType; duration_ms?: number };
    const VALID_EVENTS: InteractionEventType[] = ["view", "like", "save", "comment", "share"];
    if (!VALID_EVENTS.includes(event_type)) throw new ValidationError("Invalid event_type");
    // Don't await — respond immediately, log in background
    logInteraction(req.user!.sub, req.params.id, event_type, duration_ms).catch(() => {});
    res.status(204).send();
  } catch (err) { next(err); }
});

// DELETE /api/posts/:id
router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deletePost(req.params.id, req.user!.sub);
    res.status(204).send();
  } catch (err) { next(err); }
});

// POST /api/posts/:id/like
router.post("/:id/like", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await likePost(req.params.id, req.user!.sub);
    logInteraction(req.user!.sub, req.params.id, "like").catch(() => {});
    res.status(204).send();
  } catch (err) { next(err); }
});

// DELETE /api/posts/:id/like
router.delete("/:id/like", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await unlikePost(req.params.id, req.user!.sub);
    res.status(204).send();
  } catch (err) { next(err); }
});

// POST /api/posts/:id/save
router.post("/:id/save", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await savePost(req.params.id, req.user!.sub);
    logInteraction(req.user!.sub, req.params.id, "save").catch(() => {});
    res.status(204).send();
  } catch (err) { next(err); }
});

// DELETE /api/posts/:id/save
router.delete("/:id/save", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await unsavePost(req.params.id, req.user!.sub);
    res.status(204).send();
  } catch (err) { next(err); }
});

// GET /api/posts/:id/comments
router.get("/:id/comments", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cursor } = req.query as Record<string, string>;
    const items = await getComments(req.params.id, { cursor });
    res.json({ items, nextCursor: items[items.length - 1]?.created_at ?? null });
  } catch (err) { next(err); }
});

// POST /api/posts/:id/comments
router.post("/:id/comments", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content, parent_id } = req.body;
    if (!content?.trim()) throw new ValidationError("content is required");
    const comment = await createComment(req.params.id, req.user!.sub, { content, parent_id });
    logInteraction(req.user!.sub, req.params.id, "comment").catch(() => {});
    res.status(201).json({ comment });
  } catch (err) { next(err); }
});

// DELETE /api/posts/:id/comments/:commentId
router.delete("/:id/comments/:commentId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteComment(req.params.commentId, req.user!.sub);
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
