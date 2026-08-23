import dns from "node:dns";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";

// ─── Supabase Admin Client (server-side) ─────────────────────────────────────
// Uses the service role key — NEVER expose this to the browser.

let adminClient: SupabaseClient | null = null;

try {
  dns.setDefaultResultOrder("ipv4first");
} catch (err) {
  logger.warn("Unable to set DNS result order to ipv4first", {
    error: formatUnknownError(err),
  });
}

function formatUnknownError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    return cause ? `${err.message}; cause=${formatUnknownError(cause)}` : err.message;
  }
  return String(err);
}

type FetchInput = Parameters<typeof fetch>[0];

function describeFetchInput(input: FetchInput): string {
  try {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "unknown";
  }
}

async function supabaseFetch(input: FetchInput, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    logger.error("[supabase] fetch failed", {
      url: describeFetchInput(input),
      method: init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET"),
      error: formatUnknownError(err),
    });
    throw err;
  }
}

const supabaseOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  global: {
    fetch: supabaseFetch,
  },
};

export function getSupabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    logger.warn(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Admin operations will fall back to anon key."
    );
  }

  adminClient = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY,
    supabaseOptions
  );

  logger.info("Supabase admin client initialized.");
  return adminClient;
}

// ─── Supabase Anon Client (for server-side operations that respect RLS) ───────

let anonClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (anonClient) return anonClient;

  anonClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, supabaseOptions);

  return anonClient;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

export const STORAGE_BUCKETS = {
  UPLOADS: "user-uploads",
  AVATARS: "avatars",
} as const;

/**
 * Upload a buffer to Supabase Storage.
 * Returns the public URL or throws on error.
 */
export async function uploadToStorage(
  bucket: string,
  filePath: string,
  fileBuffer: Buffer,
  mimeType: string
): Promise<string> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(filePath, fileBuffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Supabase storage upload failed: ${error.message}`);
  }

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(data.path);
  return urlData.publicUrl;
}

/**
 * Create a signed upload URL for direct browser uploads.
 */
export async function createSignedUploadUrl(
  bucket: string,
  filePath: string,
  options: { upsert?: boolean } = {}
): Promise<{ signedUrl: string; token: string; path: string }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(filePath, { upsert: options.upsert ?? false });

  if (error || !data) {
    throw new Error(`Supabase signed upload url failed: ${error?.message ?? "unknown"}`);
  }
  return {
    signedUrl: data.signedUrl,
    token: data.token,
    path: data.path,
  };
}

/**
 * Resolve public URL for a storage path.
 */
export function getPublicStorageUrl(bucket: string, filePath: string): string {
  const supabase = getSupabaseAdmin();
  const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
  return data.publicUrl;
}

/**
 * Delete a file from Supabase Storage.
 */
export async function deleteFromStorage(bucket: string, filePath: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(bucket).remove([filePath]);
  if (error) {
    throw new Error(`Supabase storage delete failed: ${error.message}`);
  }
}
