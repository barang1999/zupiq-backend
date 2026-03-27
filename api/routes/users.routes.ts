import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import { getUserById, updateUser } from "../../services/user.service.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { AppError, NotFoundError } from "../middlewares/error.middleware.js";
import { STORAGE_BUCKETS } from "../../config/supabase.js";
import { signAccessToken } from "../../services/auth.service.js";
import type { UpdateUserDTO } from "../../models/user.model.js";
import { ensureSubscriptionSeed, getEffectiveAccessState } from "../../billing/subscription-service.js";

const AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (AVATAR_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, WebP, or GIF images are allowed."));
    }
  },
}).single("avatar");

const router = Router();

// All user routes require authentication
router.use(requireAuth);

// ─── GET /api/users/profile ──────────────────────────────────────────────────

router.get(
  "/profile",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await getUserById(req.user!.sub);
      if (!user) throw new NotFoundError("User");
      await ensureSubscriptionSeed(user.id);
      const billing = await getEffectiveAccessState(user.id);
      res.json({ user, billing });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PATCH /api/users/profile ────────────────────────────────────────────────

router.patch(
  "/profile",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = req.body as UpdateUserDTO;
      const user = await updateUser(req.user!.sub, dto);
      // Re-issue access token so language/educationLevel changes take effect immediately
      const accessToken = signAccessToken(user);
      res.json({ user, accessToken });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/users/preferences ──────────────────────────────────────────────

router.get(
  "/preferences",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await getUserById(req.user!.sub);
      if (!user) throw new NotFoundError("User");
      res.json({ preferences: user.preferences });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PATCH /api/users/preferences ────────────────────────────────────────────

router.patch(
  "/preferences",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await updateUser(req.user!.sub, { preferences: req.body });
      res.json({ preferences: user.preferences });
    } catch (err) {
      next(err);
    }
  }
);

// ─── PATCH /api/users/education ──────────────────────────────────────────────

router.patch(
  "/education",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { education_level, grade } = req.body;
      const user = await updateUser(req.user!.sub, { education_level, grade });
      res.json({ user });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/users/avatar ───────────────────────────────────────────────────

router.post(
  "/avatar",
  (req: Request, res: Response, next: NextFunction) => {
    avatarUpload(req, res, (err) => {
      if (err) return next(new AppError(err.message, 400));
      next();
    });
  },
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw new AppError("No image file provided.", 400);

      const userId = req.user!.sub;
      const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
      // Include timestamp in filename so each upload gets a unique URL,
      // preventing browser/CDN from serving a stale cached version.
      const filePath = `${userId}/avatar_${Date.now()}${ext}`;

      const supabase = (await import("../../config/supabase.js")).getSupabaseAdmin();
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKETS.AVATARS)
        .upload(filePath, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true,
        });

      if (error) throw new AppError(`Storage upload failed: ${error.message}`, 500);

      const { data: urlData } = supabase.storage
        .from(STORAGE_BUCKETS.AVATARS)
        .getPublicUrl(data.path);

      const avatarUrl = urlData.publicUrl;

      const user = await updateUser(userId, { avatar_url: avatarUrl });
      res.json({ user });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/users/:id (admin or self) ──────────────────────────────────────

router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Only allow viewing own profile for now (no admin role yet)
      if (req.params.id !== req.user!.sub) {
        // Return limited public profile
        const user = await getUserById(req.params.id);
        if (!user) throw new NotFoundError("User");
        res.json({
          user: {
            id: user.id,
            full_name: user.full_name,
            avatar_url: user.avatar_url,
            education_level: user.education_level,
          },
        });
        return;
      }

      const user = await getUserById(req.params.id);
      if (!user) throw new NotFoundError("User");
      res.json({ user });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
