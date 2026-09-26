import { getSupabaseAdmin } from "../config/supabase.js";
import {
  User,
  PublicUser,
  CreateUserDTO,
  UpdateUserDTO,
  DEFAULT_PREFERENCES,
  UserPreferences,
} from "../models/user.model.js";
import { hashPassword, toPublicUser } from "./auth.service.js";
import { generateId, nowISO, getPaginationOffset } from "../utils/helpers.js";
import { AppError, NotFoundError } from "../api/middlewares/error.middleware.js";

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createUser(dto: CreateUserDTO): Promise<PublicUser> {
  const db = getSupabaseAdmin();

  // Check for existing email
  const { data: existing } = await db
    .from("users")
    .select("id")
    .eq("email", dto.email.toLowerCase())
    .single();

  if (existing) {
    throw new AppError("Email already in use", 409);
  }

  const id = generateId();
  const passwordHash = await hashPassword(dto.password);

  const insertPayload: Record<string, any> = {
    id,
    email: dto.email.toLowerCase(),
    password_hash: passwordHash,
    full_name: dto.full_name,
    education_level: dto.education_level ?? "high_school",
    grade: dto.grade ?? null,
    language: dto.language ?? "en",
    preferences: DEFAULT_PREFERENCES,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  if (dto.country_code) insertPayload.country_code = dto.country_code;
  console.log("[user.service] createUser insert payload:", JSON.stringify({ ...insertPayload, password_hash: "[redacted]" }));

  const { data, error } = await db
    .from("users")
    .insert(insertPayload)
    .select()
    .single();

  console.log("[user.service] createUser insert result — error:", error?.message ?? null, "data.id:", (data as any)?.id ?? null);
  if (error) throw new AppError(error.message, 500);
  return toPublicUser(data as User);
}

// ─── Suggested users ─────────────────────────────────────────────────────────

export async function getSuggestedUsers(
  userId: string,
  limit = 10
): Promise<{ id: string; full_name: string; avatar_url: string | null; detected_level: string | null; level_confidence: number }[]> {
  const db = getSupabaseAdmin();

  // Get current user for scoring
  const { data: me } = await db.from("users").select("preferences").eq("id", userId).single();
  const mySubjects: string[] = (me?.preferences as any)?.subjects ?? [];
  const myCountry: string | null = null; // country_code scoring deferred until schema cache refreshes

  // Get IDs the user already follows
  const { data: follows } = await db.from("user_follows").select("following_id").eq("follower_id", userId);
  const followedIds = new Set((follows ?? []).map((f: any) => f.following_id));

  // Fetch candidate pool (recent users, excluding self + already followed)
  const { data: candidates, error } = await db
    .from("users")
    .select("id, full_name, avatar_url, preferences, detected_level, level_confidence")
    .neq("id", userId)
    .order("created_at", { ascending: false })
    .limit(200);

  console.log("[suggestions] me — country:", myCountry, "subjects:", mySubjects);
  console.log("[suggestions] already following:", followedIds.size, "ids");
  console.log("[suggestions] candidates fetched:", candidates?.length ?? 0, "error:", error?.message ?? null);

  if (error || !candidates) return [];

  // Score and rank
  const scored = (candidates as any[])
    .filter((u) => !followedIds.has(u.id))
    .map((u) => {
      const theirSubjects: string[] = (u.preferences as any)?.subjects ?? [];
      const subjectOverlap = mySubjects.filter((s) => theirSubjects.includes(s)).length;
      const countryMatch = myCountry && u.country_code === myCountry ? 2 : 0;
      return { ...u, _score: subjectOverlap * 3 + countryMatch };
    })
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, preferences, ...u }) => ({
      ...u,
      detected_level: u.detected_level ?? null,
      level_confidence: u.level_confidence ?? 0,
    }));

  console.log("[suggestions] returning", scored.length, "users:", scored.map(u => ({ id: u.id, name: u.full_name, country: u.country_code })));
  return scored;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getUserById(id: string): Promise<PublicUser | null> {
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return toPublicUser(data as User);
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("users")
    .select("*")
    .eq("email", email.toLowerCase())
    .single();

  if (error || !data) return null;
  return data as User;
}

export async function listUsers(params: { page?: number; limit?: number } = {}): Promise<PublicUser[]> {
  const db = getSupabaseAdmin();
  const { offset, limit } = getPaginationOffset(params);

  const { data, error } = await db
    .from("users")
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new AppError(error.message, 500);
  return (data as User[]).map((r) => toPublicUser(r));
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateUser(id: string, dto: UpdateUserDTO): Promise<PublicUser> {
  const db = getSupabaseAdmin();

  const { data: existing, error: fetchError } = await db
    .from("users")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !existing) throw new NotFoundError("User");

  const existingUser = existing as User;
  const currentPrefs: UserPreferences = (existingUser.preferences as UserPreferences) ?? {};
  const mergedPrefs = dto.preferences
    ? { ...currentPrefs, ...dto.preferences }
    : currentPrefs;

  const { data, error } = await db
    .from("users")
    .update({
      full_name: dto.full_name ?? existingUser.full_name,
      education_level: dto.education_level ?? existingUser.education_level,
      grade: dto.grade ?? existingUser.grade,
      language: dto.language ?? existingUser.language,
      country_code: "country_code" in dto ? dto.country_code : existingUser.country_code,
      avatar_url: dto.avatar_url ?? existingUser.avatar_url,
      preferences: mergedPrefs,
      updated_at: nowISO(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);
  if (!data) throw new AppError("Failed to update user", 500);
  return toPublicUser(data as User);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteUser(id: string): Promise<void> {
  const db = getSupabaseAdmin();

  const { data: existing } = await db
    .from("users")
    .select("id")
    .eq("id", id)
    .single();

  if (!existing) throw new NotFoundError("User");

  const { error } = await db.from("users").delete().eq("id", id);
  if (error) throw new AppError(error.message, 500);
}
