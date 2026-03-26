import path from "path";
import fs from "fs";
import { Request } from "express";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

// Ensure upload directory exists
const uploadDir = path.resolve(env.UPLOAD_DIR);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  logger.info(`Upload directory created at ${uploadDir}`);
}

// ─── File filter ──────────────────────────────────────────────────────────────

function isAllowedMimeType(mimetype: string): boolean {
  return env.ALLOWED_FILE_TYPES.includes(mimetype);
}

// ─── Manual multer-style configuration ───────────────────────────────────────
// We configure multer lazily to avoid import issues with ESM.
// Use getUploadMiddleware() to obtain the configured multer instance.

let _multer: typeof import("multer") | null = null;

async function getMulter() {
  if (!_multer) {
    // Dynamic import to handle ESM/CJS interop
    const mod = await import("multer");
    _multer = mod.default ?? (mod as unknown as typeof import("multer"));
  }
  return _multer;
}

export async function createUploadMiddleware(fieldName = "file", maxCount = 1) {
  const multer = await getMulter();

  const storage = (multer as any).diskStorage({
    destination(_req: Request, _file: Express.Multer.File, cb: (err: Error | null, dest: string) => void) {
      cb(null, uploadDir);
    },
    filename(_req: Request, file: Express.Multer.File, cb: (err: Error | null, name: string) => void) {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = path.extname(file.originalname);
      cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    },
  });

  const fileFilter = (
    _req: Request,
    file: Express.Multer.File,
    cb: (err: Error | null, accept: boolean) => void
  ) => {
    if (isAllowedMimeType(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed.`), false);
    }
  };

  const upload = (multer as any)({
    storage,
    fileFilter,
    limits: {
      fileSize: env.UPLOAD_MAX_SIZE_MB * 1024 * 1024,
    },
  });

  return upload.array(fieldName, maxCount);
}

// ─── Export upload directory path for use in services ─────────────────────────

export { uploadDir };
