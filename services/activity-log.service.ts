import { getSupabaseAdmin } from "../config/supabase.js";
import { generateId, nowISO } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";
import type { ActivityAction, ActivityLogEntry, ActivityMetadata } from "../models/activity-log.model.js";
import { publishCollabEvent } from "./collab-stream.js";

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget activity log insert.
 * Never throws — logging failures must not break the calling request.
 */
export function logActivity(
  sessionId: string,
  userId: string | null,
  action: ActivityAction,
  metadata: ActivityMetadata = {}
): void {
  const entry = {
    id: generateId(),
    session_id: sessionId,
    user_id: userId,
    action,
    metadata,
    created_at: nowISO(),
  };

  Promise.resolve(
    getSupabaseAdmin()
      .from("session_activity_log")
      .insert(entry)
  ).then(({ error }) => {
    if (error) {
      logger.warn("[activity-log] insert failed", {
        sessionId,
        action,
        error: error.message,
      });
    } else {
      // Broadcast activity log signal to all session members.
      publishCollabEvent(sessionId, "activity_logged", {
        activityId: entry.id,
        action: entry.action,
        userId: entry.user_id,
      });
    }
  }).catch((err) => {
    logger.warn("[activity-log] unexpected error", {
      sessionId,
      action,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getSessionActivity(
  sessionId: string,
  limit = 50
): Promise<ActivityLogEntry[]> {
  const db = getSupabaseAdmin();

  const { data: rows, error } = await db
    .from("session_activity_log")
    .select("id, session_id, user_id, action, metadata, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    logger.warn("[activity-log] read failed", { sessionId, error: error.message });
    return [];
  }

  if (!rows || rows.length === 0) return [];

  // Resolve actor names in one batch query
  const userIds = [
    ...new Set(
      (rows as Array<Record<string, unknown>>)
        .map((r) => r.user_id as string | null)
        .filter(Boolean) as string[]
    ),
  ];

  const nameMap = new Map<string, { full_name: string; avatar_url: string | null }>();

  if (userIds.length > 0) {
    const { data: users } = await db
      .from("users")
      .select("id, full_name, avatar_url")
      .in("id", userIds);

    (users ?? []).forEach((u: Record<string, unknown>) => {
      nameMap.set(String(u.id), {
        full_name: String(u.full_name ?? ""),
        avatar_url: (u.avatar_url as string | null) ?? null,
      });
    });
  }

  return (rows as Array<Record<string, unknown>>).map((row) => {
    const actorInfo = row.user_id ? nameMap.get(String(row.user_id)) : undefined;
    return {
      id: String(row.id),
      session_id: String(row.session_id),
      user_id: (row.user_id as string | null) ?? null,
      action: String(row.action) as ActivityAction,
      metadata: (row.metadata ?? {}) as ActivityMetadata,
      created_at: String(row.created_at),
      actor_name: actorInfo?.full_name ?? null,
      actor_avatar: actorInfo?.avatar_url ?? null,
    };
  });
}
