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

  const { data, error } = await db
    .from("users")
    .insert({
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
    })
    .select()
    .single();

  if (error) throw new AppError(error.message, 500);
  return toPublicUser(data as User);
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
