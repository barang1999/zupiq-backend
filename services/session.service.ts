import { getSupabaseAdmin } from "../config/supabase.js";
import { StudySession, CreateSessionDTO } from "../models/session.model.js";
import { generateId, nowISO } from "../utils/helpers.js";
import { AppError } from "../api/middlewares/error.middleware.js";

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createSession(userId: string, dto: CreateSessionDTO): Promise<StudySession> {
  const db = getSupabaseAdmin();

  const session: StudySession = {
    id: generateId(),
    user_id: userId,
    title: dto.title,
    subject: dto.subject,
    problem: dto.problem,
    node_count: dto.node_count,
    duration_seconds: dto.duration_seconds ?? null,
    breakdown_json: dto.breakdown_json,
    created_at: nowISO(),
  };

  const { data, error } = await db
    .from("study_sessions")
    .insert(session)
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);
  return data as StudySession;
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateSession(id: string, userId: string, updates: Partial<StudySession>): Promise<StudySession> {
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("study_sessions")
    .update(updates)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);
  return data as StudySession;
}

export async function getUserSessions(userId: string): Promise<StudySession[]> {
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("study_sessions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new AppError(error.message, 500);
  return (data ?? []) as StudySession[];
}

export async function getSessionById(id: string, userId: string): Promise<StudySession | null> {
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("study_sessions")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (error) return null;
  return data as StudySession;
}
