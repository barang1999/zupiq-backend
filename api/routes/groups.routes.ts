import { Router, Request, Response, NextFunction } from "express";
import {
  createGroup,
  getGroupById,
  listPublicGroups,
  getUserGroups,
  updateGroup,
  deleteGroup,
  joinGroupByCode,
  removeMember,
  listMembers,
  createPost,
  listPosts,
  getMember,
} from "../../services/group.service.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { ValidationError, NotFoundError, ForbiddenError } from "../middlewares/error.middleware.js";
import type { CreateGroupDTO, UpdateGroupDTO, CreateGroupPostDTO } from "../../models/group.model.js";

const router = Router();
router.use(requireAuth);

// ─── Groups CRUD ──────────────────────────────────────────────────────────────

// GET /api/groups — list public groups
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const subject = req.query.subject as string | undefined;

    const groups = await listPublicGroups({ page, limit, subject });
    res.json({ groups });
  } catch (err) {
    next(err);
  }
});

// GET /api/groups/mine — user's groups
router.get("/mine", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groups = await getUserGroups(req.user!.sub);
    res.json({ groups });
  } catch (err) {
    next(err);
  }
});

// POST /api/groups — create group
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = req.body as CreateGroupDTO;
    if (!dto.name) throw new ValidationError("name is required");

    const group = await createGroup(req.user!.sub, dto);
    res.status(201).json({ group });
  } catch (err) {
    next(err);
  }
});

// GET /api/groups/:id
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await getGroupById(req.params.id);
    if (!group) throw new NotFoundError("Group");
    res.json({ group });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/groups/:id
router.patch("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = req.body as UpdateGroupDTO;
    const group = await updateGroup(req.params.id, req.user!.sub, dto);
    res.json({ group });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/groups/:id
router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteGroup(req.params.id, req.user!.sub);
    res.json({ message: "Group deleted" });
  } catch (err) {
    next(err);
  }
});

// ─── Membership ───────────────────────────────────────────────────────────────

// POST /api/groups/join — join by invite code
router.post("/join", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { invite_code } = req.body;
    if (!invite_code) throw new ValidationError("invite_code is required");

    const group = await joinGroupByCode(req.user!.sub, invite_code);
    res.json({ group, message: "Joined group successfully" });
  } catch (err) {
    next(err);
  }
});

// GET /api/groups/:id/members
router.get("/:id/members", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await getGroupById(req.params.id);
    if (!group) throw new NotFoundError("Group");

    if (!group.is_public) {
      const member = await getMember(req.params.id, req.user!.sub);
      if (!member) throw new ForbiddenError("This group is private");
    }

    const members = await listMembers(req.params.id);
    res.json({ members });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/groups/:id/members/:userId — leave or remove member
router.delete("/:id/members/:userId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await removeMember(req.params.id, req.params.userId, req.user!.sub);
    res.json({ message: "Member removed" });
  } catch (err) {
    next(err);
  }
});

// ─── Posts ────────────────────────────────────────────────────────────────────

// GET /api/groups/:id/posts
router.get("/:id/posts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const group = await getGroupById(req.params.id);
    if (!group) throw new NotFoundError("Group");

    const member = await getMember(req.params.id, req.user!.sub);
    if (!member && !group.is_public) throw new ForbiddenError("Members only");

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const posts = await listPosts(req.params.id, { page, limit });
    res.json({ posts });
  } catch (err) {
    next(err);
  }
});

// POST /api/groups/:id/posts
router.post("/:id/posts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = req.body as CreateGroupPostDTO;
    if (!dto.content) throw new ValidationError("content is required");

    const post = await createPost(req.params.id, req.user!.sub, dto);
    res.status(201).json({ post });
  } catch (err) {
    next(err);
  }
});

export default router;
