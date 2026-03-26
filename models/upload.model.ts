// ─── Enums ────────────────────────────────────────────────────────────────────

export type UploadContext = "ai_query" | "lesson" | "profile_avatar" | "group" | "general";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface Upload {
  id: string;
  user_id: string;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  storage_url: string | null;
  context: UploadContext;
  created_at: string;
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateUploadDTO {
  user_id: string;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  storage_url?: string;
  context?: UploadContext;
}

// ─── Multer file type (matches Express.Multer.File shape) ─────────────────────

export interface UploadedFileInfo {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  filename: string;
  path: string;
  buffer?: Buffer;
}
