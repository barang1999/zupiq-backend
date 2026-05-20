import { getSupabaseAdmin } from "../config/supabase.js";

export type FeedbackSignal = "positive" | "negative";

/**
 * Upsert a breakdown feedback signal for a given user + session.
 * Calling again with a different signal switches it; same signal is a no-op.
 */
export async function upsertBreakdownFeedback(
  sessionId: string,
  userId: string,
  signal: FeedbackSignal
): Promise<void> {
  const db = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { error } = await db.from("breakdown_feedback").upsert(
    { session_id: sessionId, user_id: userId, signal, updated_at: now },
    { onConflict: "session_id,user_id" }
  );

  if (error) throw new Error(error.message);
}

/**
 * Remove the user's feedback for a session (allows un-rating).
 * Silently succeeds if no feedback exists.
 */
export async function deleteBreakdownFeedback(
  sessionId: string,
  userId: string
): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("breakdown_feedback")
    .delete()
    .eq("session_id", sessionId)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
}

/**
 * Returns the user's current signal for a session, or null if none.
 */
export async function getBreakdownFeedback(
  sessionId: string,
  userId: string
): Promise<FeedbackSignal | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("breakdown_feedback")
    .select("signal")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data?.signal as FeedbackSignal) ?? null;
}
