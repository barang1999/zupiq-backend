import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { followUser, unfollowUser, getPublicProfile } from "../../services/social.service.js";

const router = Router();
router.use(requireAuth);

// POST /api/users/:id/follow
router.post("/:id/follow", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await followUser(req.user!.sub, req.params.id);
    res.status(204).send();
  } catch (err) { next(err); }
});

// DELETE /api/users/:id/follow
router.delete("/:id/follow", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await unfollowUser(req.user!.sub, req.params.id);
    res.status(204).send();
  } catch (err) { next(err); }
});

// GET /api/users/:id/profile
router.get("/:id/profile", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const profile = await getPublicProfile(req.params.id, req.user!.sub);
    if (!profile) return res.status(404).json({ error: "User not found" });
    res.json({ profile });
  } catch (err) { next(err); }
});

export default router;
