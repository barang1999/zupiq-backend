import { Router, Request, Response, NextFunction } from "express";
import path from "path";
import {
  saveUpload,
  getUserUploads,
  getUploadById,
  deleteUpload,
  uploadFileToStorage,
} from "../../services/upload.service.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { createUploadMiddleware, uploadDir } from "../middlewares/upload.middleware.js";
import { ValidationError, NotFoundError, ForbiddenError } from "../middlewares/error.middleware.js";
import type { UploadContext } from "../../models/upload.model.js";

const router = Router();
router.use(requireAuth);

// ─── POST /api/uploads ────────────────────────────────────────────────────────

router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Dynamically apply multer middleware
      const uploadMiddleware = await createUploadMiddleware("file", 5);

      uploadMiddleware(req, res, async (err: unknown) => {
        if (err) {
          return next(err);
        }

        const files = req.files as Express.Multer.File[] | undefined;
        if (!files || files.length === 0) {
          return next(new ValidationError("No files uploaded"));
        }

        const context = (req.body.context as UploadContext) ?? "general";
        const uploads = [];

        for (const file of files) {
          const localPath = path.resolve(uploadDir, file.filename);

          // Try to push to Supabase storage
          let storageUrl: string | undefined;
          try {
            const result = await uploadFileToStorage(
              req.user!.id,
              localPath,
              file.originalname,
              file.mimetype
            );
            storageUrl = result.storageUrl;
          } catch {
            storageUrl = `/uploads/${file.filename}`;
          }

          const upload = await saveUpload({
            user_id: req.user!.id,
            original_name: file.originalname,
            stored_name: file.filename,
            mime_type: file.mimetype,
            size_bytes: file.size,
            storage_url: storageUrl,
            context,
          });

          uploads.push(upload);
        }

        res.status(201).json({ uploads });
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/uploads ─────────────────────────────────────────────────────────

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const context = req.query.context as UploadContext | undefined;

    const uploads = await getUserUploads(req.user!.id, { page, limit, context });
    res.json({ uploads });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/uploads/:id ─────────────────────────────────────────────────────

router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const upload = await getUploadById(req.params.id);
    if (!upload) throw new NotFoundError("Upload");
    if (upload.user_id !== req.user!.id) throw new ForbiddenError("Access denied");
    res.json({ upload });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/uploads/:id ──────────────────────────────────────────────────

router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteUpload(req.params.id, req.user!.id);
    res.json({ message: "Upload deleted" });
  } catch (err) {
    next(err);
  }
});

export default router;
