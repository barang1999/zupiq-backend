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
import type { Upload, UploadContext } from "../../models/upload.model.js";
import { logger } from "../../utils/logger.js";
import { generateId } from "../../utils/helpers.js";
import { createSignedUploadUrl, getPublicStorageUrl, STORAGE_BUCKETS } from "../../config/supabase.js";
import { env } from "../../config/env.js";

const router = Router();
router.use(requireAuth);

function getAttachTraceId(req: Request): string {
  const body = req.body as Record<string, unknown> | undefined;
  const bodyTrace = typeof body?.attach_trace_id === "string" ? body.attach_trace_id.trim() : "";
  if (bodyTrace) return bodyTrace;
  const header = req.headers["x-attach-trace-id"];
  if (typeof header === "string" && header.trim()) return header.trim();
  if (Array.isArray(header) && typeof header[0] === "string" && header[0].trim()) return header[0].trim();
  return `srv_upl_${generateId().slice(0, 12)}`;
}

function resolveUploadExtension(originalName: string, mimeType: string): string {
  const fromName = path.extname(originalName || "").toLowerCase();
  if (fromName) return fromName;
  const fromMime: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
  };
  return fromMime[mimeType] ?? ".bin";
}

function isMimeTypeAllowedForContext(mimeType: string, context: UploadContext): boolean {
  if (env.ALLOWED_FILE_TYPES.includes(mimeType)) return true;
  // Avatar flow supports GIF in addition to generic upload types.
  if (context === "profile_avatar" && mimeType === "image/gif") return true;
  return false;
}

function resolveStorageBucketForContext(context: UploadContext): string {
  return context === "profile_avatar" ? STORAGE_BUCKETS.AVATARS : STORAGE_BUCKETS.UPLOADS;
}

// ─── POST /api/uploads/signed-upload-url ─────────────────────────────────────

router.post(
  "/signed-upload-url",
  async (req: Request, res: Response, next: NextFunction) => {
    const traceId = getAttachTraceId(req);
    const startedAt = Date.now();
    try {
      const originalName = String(req.body.original_name ?? "").trim();
      const mimeType = String(req.body.mime_type ?? "").trim();
      const sizeBytes = Number(req.body.size_bytes ?? 0);
      const context = ((req.body.context as UploadContext) ?? "general");

      if (!originalName) throw new ValidationError("original_name is required");
      if (!mimeType) throw new ValidationError("mime_type is required");
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new ValidationError("size_bytes must be > 0");
      if (!isMimeTypeAllowedForContext(mimeType, context)) {
        throw new ValidationError(`File type ${mimeType} is not allowed.`);
      }
      if (sizeBytes > env.UPLOAD_MAX_SIZE_MB * 1024 * 1024) {
        throw new ValidationError(`File too large. Max ${env.UPLOAD_MAX_SIZE_MB}MB.`);
      }

      const ext = resolveUploadExtension(originalName, mimeType);
      const storagePath = `${req.user!.sub}/${generateId()}${ext}`;
      const storageBucket = resolveStorageBucketForContext(context);
      const signed = await createSignedUploadUrl(storageBucket, storagePath, { upsert: false });
      const storageUrl = getPublicStorageUrl(storageBucket, storagePath);

      const upload = await saveUpload({
        user_id: req.user!.sub,
        original_name: originalName,
        stored_name: storagePath,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        storage_url: storageUrl,
        context,
      });

      logger.info("[uploads] signed-upload-url:created", {
        traceId,
        userId: req.user?.sub ?? null,
        uploadId: upload.id,
        context,
        originalName,
        mimeType,
        sizeBytes,
        storageBucket,
        storagePath,
        elapsedMs: Date.now() - startedAt,
      });

      res.status(201).json({
        upload,
        signed_upload: {
          bucket: storageBucket,
          path: signed.path,
          token: signed.token,
          signedUrl: signed.signedUrl,
        },
      });
    } catch (err) {
      logger.error("[uploads] signed-upload-url:error", {
        traceId,
        userId: req.user?.sub ?? null,
        message: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - startedAt,
      });
      next(err);
    }
  }
);

// ─── POST /api/uploads ────────────────────────────────────────────────────────

router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    let traceId = getAttachTraceId(req);
    const startedAt = Date.now();
    logger.info("[uploads] request:start", {
      traceId,
      userId: req.user?.sub ?? null,
      origin: req.headers.origin ?? null,
      contentType: req.headers["content-type"] ?? null,
      contentLength: req.headers["content-length"] ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });
    try {
      // Dynamically apply multer middleware
      const uploadMiddleware = await createUploadMiddleware("file", 5);

      uploadMiddleware(req, res, async (err: unknown) => {
        traceId = getAttachTraceId(req);
        if (err) {
          logger.error("[uploads] multer:error", {
            traceId,
            userId: req.user?.sub ?? null,
            message: err instanceof Error ? err.message : String(err),
            elapsedMs: Date.now() - startedAt,
          });
          return next(err);
        }

        const files = req.files as Express.Multer.File[] | undefined;
        if (!files || files.length === 0) {
          logger.warn("[uploads] no-files", {
            traceId,
            userId: req.user?.sub ?? null,
            elapsedMs: Date.now() - startedAt,
          });
          return next(new ValidationError("No files uploaded"));
        }

        const context = (req.body.context as UploadContext) ?? "general";
        logger.info("[uploads] parsed:files", {
          traceId,
          userId: req.user?.sub ?? null,
          context,
          fileCount: files.length,
          files: files.map((f) => ({
            originalName: f.originalname,
            mimetype: f.mimetype,
            sizeBytes: f.size,
            storedName: f.filename,
          })),
        });
        const uploads: Upload[] = [];

        for (const file of files) {
          const localPath = path.resolve(uploadDir, file.filename);
          const fileStartedAt = Date.now();

          // Try to push to Supabase storage
          let storageUrl: string | undefined;
          let storedNameForRecord = file.filename;
          try {
            const result = await uploadFileToStorage(
              req.user!.sub,
              localPath,
              file.originalname,
              file.mimetype
            );
            storageUrl = result.storageUrl;
            storedNameForRecord = result.storagePath || file.filename;
            logger.info("[uploads] storage:ok", {
              traceId,
              originalName: file.originalname,
              storedName: file.filename,
              storedNameForRecord,
              storageUrl,
              remoteStorage: storageUrl.startsWith("https://"),
              elapsedMs: Date.now() - fileStartedAt,
            });
          } catch {
            storageUrl = `/uploads/${file.filename}`;
            storedNameForRecord = file.filename;
            logger.warn("[uploads] storage:fallback-local", {
              traceId,
              originalName: file.originalname,
              storedName: file.filename,
              storedNameForRecord,
              storageUrl,
              elapsedMs: Date.now() - fileStartedAt,
            });
          }

          const upload = await saveUpload({
            user_id: req.user!.sub,
            original_name: file.originalname,
            stored_name: storedNameForRecord,
            mime_type: file.mimetype,
            size_bytes: file.size,
            storage_url: storageUrl,
            context,
          });

          logger.info("[uploads] db:inserted", {
            traceId,
            uploadId: upload.id,
            originalName: upload.original_name,
            storedName: upload.stored_name,
            mimeType: upload.mime_type,
            sizeBytes: upload.size_bytes,
            storageUrl: upload.storage_url,
          });
          uploads.push(upload);
        }

        logger.info("[uploads] request:success", {
          traceId,
          userId: req.user?.sub ?? null,
          uploadCount: uploads.length,
          uploadIds: uploads.map((u) => u.id),
          elapsedMs: Date.now() - startedAt,
        });
        res.status(201).json({ uploads });
      });
    } catch (err) {
      logger.error("[uploads] request:exception", {
        traceId,
        userId: req.user?.sub ?? null,
        message: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - startedAt,
      });
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

    const uploads = await getUserUploads(req.user!.sub, { page, limit, context });
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
    if (upload.user_id !== req.user!.sub) throw new ForbiddenError("Access denied");
    res.json({ upload });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/uploads/:id ──────────────────────────────────────────────────

router.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteUpload(req.params.id, req.user!.sub);
    res.json({ message: "Upload deleted" });
  } catch (err) {
    next(err);
  }
});

export default router;
