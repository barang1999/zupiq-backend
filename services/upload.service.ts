import fs from "fs";
import path from "path";
import sharp from "sharp";
import { getSupabaseAdmin } from "../config/supabase.js";
import { Upload, CreateUploadDTO, UploadContext } from "../models/upload.model.js";
import { uploadToStorage, deleteFromStorage, STORAGE_BUCKETS } from "../config/supabase.js";
import { generateId, nowISO, getPaginationOffset } from "../utils/helpers.js";
import { NotFoundError, ForbiddenError, AppError } from "../api/middlewares/error.middleware.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";

function resolveStorageBucketForUpload(upload: Pick<Upload, "context">): string {
  return upload.context === "profile_avatar" ? STORAGE_BUCKETS.AVATARS : STORAGE_BUCKETS.UPLOADS;
}

// ─── Save upload record ───────────────────────────────────────────────────────

export async function saveUpload(dto: CreateUploadDTO): Promise<Upload> {
  const db = getSupabaseAdmin();
  const id = generateId();

  const { data, error } = await db
    .from("uploads")
    .insert({
      id,
      user_id: dto.user_id,
      original_name: dto.original_name,
      stored_name: dto.stored_name,
      mime_type: dto.mime_type,
      size_bytes: dto.size_bytes,
      storage_url: dto.storage_url ?? null,
      context: dto.context ?? "general",
      created_at: nowISO(),
    })
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);
  return data as Upload;
}

// ─── Upload to Supabase Storage ───────────────────────────────────────────────

export async function uploadFileToStorage(
  userId: string,
  localFilePath: string,
  originalName: string,
  mimeType: string
): Promise<{ storageUrl: string; storagePath: string }> {
  const buffer = fs.readFileSync(localFilePath);
  const ext = path.extname(originalName);
  const storagePath = `${userId}/${generateId()}${ext}`;

  try {
    const storageUrl = await uploadToStorage(
      STORAGE_BUCKETS.UPLOADS,
      storagePath,
      buffer,
      mimeType
    );
    return { storageUrl, storagePath };
  } catch (err) {
    logger.warn("Supabase storage upload failed, falling back to local:", err);
    // Return a local file URL as fallback
    const localUrl = `/uploads/${path.basename(localFilePath)}`;
    return { storageUrl: localUrl, storagePath: path.basename(localFilePath) };
  }
}

const ARCHIVE_IMAGE_TARGET_BYTES = 500 * 1024;
const ARCHIVE_IMAGE_MAX_PX = 2048;
const ARCHIVE_IMAGE_MIN_PX = 720;

export type OptimizedArchiveImage = {
  filePath: string;
  storageFileName: string;
  mimeType: "image/jpeg";
  sizeBytes: number;
  width: number;
  height: number;
  compressed: boolean;
};

/**
 * Normalize an Archive photo before permanent storage. This follows the same
 * broad production pattern used by large social-photo pipelines: fix EXIF
 * orientation, cap oversized dimensions, strip metadata, and adapt JPEG
 * quality/dimensions until the byte budget is met.
 */
export async function optimizeArchiveImage(
  localFilePath: string,
  originalName: string,
): Promise<OptimizedArchiveImage> {
  const original = fs.readFileSync(localFilePath);
  const inputMetadata = await sharp(original).metadata();
  const orientedWidth = inputMetadata.autoOrient?.width ?? inputMetadata.width ?? ARCHIVE_IMAGE_MAX_PX;
  const orientedHeight = inputMetadata.autoOrient?.height ?? inputMetadata.height ?? ARCHIVE_IMAGE_MAX_PX;
  const longest = Math.max(orientedWidth, orientedHeight);
  const outputName = `${path.parse(originalName || "archive-photo").name || "archive-photo"}.jpg`;

  if (original.length <= ARCHIVE_IMAGE_TARGET_BYTES && inputMetadata.format === "jpeg") {
    return {
      filePath: localFilePath,
      storageFileName: outputName,
      mimeType: "image/jpeg",
      sizeBytes: original.length,
      width: orientedWidth,
      height: orientedHeight,
      compressed: false,
    };
  }

  let targetLongest = Math.min(longest, ARCHIVE_IMAGE_MAX_PX);
  let quality = 86;
  let bestBuffer: Buffer | null = null;
  let bestWidth = orientedWidth;
  let bestHeight = orientedHeight;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const resizedWidth = orientedWidth >= orientedHeight ? targetLongest : undefined;
    const resizedHeight = orientedHeight > orientedWidth ? targetLongest : undefined;
    const pipeline = sharp(original)
      .rotate()
      .resize(resizedWidth, resizedHeight, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#FFFFFF" })
      .jpeg({
        quality,
        progressive: true,
        mozjpeg: true,
        chromaSubsampling: "4:2:0",
      });
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    if (!bestBuffer || data.length < bestBuffer.length) {
      bestBuffer = data;
      bestWidth = info.width;
      bestHeight = info.height;
    }
    if (data.length <= ARCHIVE_IMAGE_TARGET_BYTES) break;

    if (targetLongest > ARCHIVE_IMAGE_MIN_PX) {
      const sizeRatio = Math.sqrt(ARCHIVE_IMAGE_TARGET_BYTES / data.length) * 0.96;
      const scale = Math.min(0.92, Math.max(0.72, sizeRatio));
      targetLongest = Math.max(ARCHIVE_IMAGE_MIN_PX, Math.floor(targetLongest * scale));
      quality = Math.max(78, quality - 1);
    } else {
      quality = Math.max(50, quality - 6);
    }
  }

  if (!bestBuffer) throw new AppError("Could not optimize Archive image.", 422);
  if (bestBuffer.length > ARCHIVE_IMAGE_TARGET_BYTES) {
    throw new AppError("Could not compress Archive image below 500 KB.", 422);
  }
  const optimizedPath = path.join(
    path.dirname(localFilePath),
    `${path.parse(localFilePath).name}-archive.jpg`,
  );
  fs.writeFileSync(optimizedPath, bestBuffer);
  logger.info("[upload] archive image optimized", {
    originalBytes: original.length,
    optimizedBytes: bestBuffer.length,
    originalDims: `${orientedWidth}x${orientedHeight}`,
    optimizedDims: `${bestWidth}x${bestHeight}`,
    targetBytes: ARCHIVE_IMAGE_TARGET_BYTES,
  });
  return {
    filePath: optimizedPath,
    storageFileName: outputName,
    mimeType: "image/jpeg",
    sizeBytes: bestBuffer.length,
    width: bestWidth,
    height: bestHeight,
    compressed: true,
  };
}

// ─── Get uploads ──────────────────────────────────────────────────────────────

export async function getUploadById(id: string): Promise<Upload | null> {
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("uploads")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as Upload;
}

export async function getUserUploads(
  userId: string,
  params: { page?: number; limit?: number; context?: UploadContext } = {}
): Promise<Upload[]> {
  const db = getSupabaseAdmin();
  const { offset, limit } = getPaginationOffset(params);

  let query = db
    .from("uploads")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (params.context) {
    query = query.eq("context", params.context);
  }

  const { data, error } = await query;
  if (error) throw new AppError(error.message, 500);
  return (data ?? []) as Upload[];
}

// ─── Delete upload ────────────────────────────────────────────────────────────

export async function deleteUpload(id: string, userId: string): Promise<void> {
  const upload = await getUploadById(id);
  if (!upload) throw new NotFoundError("Upload");
  if (upload.user_id !== userId) throw new ForbiddenError("Cannot delete this upload");

  // Try to delete from Supabase storage
  if (upload.storage_url && upload.storage_url.startsWith("https://")) {
    try {
      await deleteFromStorage(resolveStorageBucketForUpload(upload), upload.stored_name);
    } catch (err) {
      logger.warn("Failed to delete from Supabase storage:", err);
    }
  } else {
    // Delete local file
    const localPath = path.resolve(env.UPLOAD_DIR, upload.stored_name);
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }
  }

  const db = getSupabaseAdmin();
  const { error } = await db.from("uploads").delete().eq("id", id);
  if (error) throw new AppError(error.message, 500);
}

// ─── Read file as base64 (for AI vision) ─────────────────────────────────────

export function readFileAsBase64(filePath: string): { data: string; mimeType: string } {
  const buffer = fs.readFileSync(filePath);
  return {
    data: buffer.toString("base64"),
    mimeType: getMimeFromExtension(path.extname(filePath)),
  };
}

/**
 * Read upload bytes from local disk (legacy flow) or Supabase Storage (direct-upload flow).
 */
// Gemini tiles images at 258 tokens per 512×512 block. Resizing to ≤1024px on the
// longest side keeps math text fully legible while capping image tokens to ~4 tiles
// (vs 12+ tiles for a full phone photo). JPEG quality 85 is indistinguishable for OCR.
const AI_IMAGE_MAX_PX = 1024;
const AI_IMAGE_JPEG_QUALITY = 85;

async function resizeForAI(buffer: Buffer, mimeType: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!mimeType.startsWith("image/") || mimeType === "image/gif") {
    return { buffer, mimeType };
  }
  try {
    const metadata = await sharp(buffer).metadata();
    const { width = 0, height = 0 } = metadata;
    const longest = Math.max(width, height);
    if (longest <= AI_IMAGE_MAX_PX) {
      return { buffer, mimeType };
    }
    const resized = await sharp(buffer)
      .resize(
        width >= height ? AI_IMAGE_MAX_PX : undefined,
        height > width ? AI_IMAGE_MAX_PX : undefined,
        { fit: "inside", withoutEnlargement: true }
      )
      .jpeg({ quality: AI_IMAGE_JPEG_QUALITY })
      .toBuffer();
    logger.info("[upload] image resized for AI", {
      originalBytes: buffer.length,
      resizedBytes: resized.length,
      originalDims: `${width}x${height}`,
      maxPx: AI_IMAGE_MAX_PX,
    });
    return { buffer: resized, mimeType: "image/jpeg" };
  } catch (err) {
    logger.warn("[upload] image resize failed, using original", {
      err: err instanceof Error ? err.message : String(err),
    });
    return { buffer, mimeType };
  }
}

export async function readUploadAsBase64(
  upload: Upload,
  { resizeForAi = false }: { resizeForAi?: boolean } = {}
): Promise<{ data: string; mimeType: string; source: "local" | "supabase"; storagePath?: string }> {
  const localPath = path.resolve(env.UPLOAD_DIR, upload.stored_name);
  if (fs.existsSync(localPath)) {
    let buffer = fs.readFileSync(localPath);
    let mimeType = upload.mime_type || getMimeFromExtension(path.extname(localPath));
    if (resizeForAi) ({ buffer, mimeType } = await resizeForAI(buffer, mimeType));
    return { data: buffer.toString("base64"), mimeType, source: "local" };
  }

  const supabase = getSupabaseAdmin();
  const storagePath = upload.stored_name;
  const storageBucket = resolveStorageBucketForUpload(upload);
  const { data, error } = await supabase.storage
    .from(storageBucket)
    .download(storagePath);

  if (error || !data) {
    throw new AppError(`Failed to read upload from storage: ${error?.message ?? "not found"}`, 500);
  }

  let buffer = Buffer.from(await data.arrayBuffer());
  let mimeType = upload.mime_type || getMimeFromExtension(path.extname(storagePath));
  if (resizeForAi) ({ buffer, mimeType } = await resizeForAI(buffer, mimeType));
  return { data: buffer.toString("base64"), mimeType, source: "supabase", storagePath };
}

function getMimeFromExtension(ext: string): string {
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}
