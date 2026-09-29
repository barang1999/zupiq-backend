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
): Promise<{ id: string; full_name: string; avatar_url: string | null; detected_level: string | null; level_confidence: number; is_verified: boolean }[]> {
  const db = getSupabaseAdmin();

  const userFields = "id, full_name, avatar_url, preferences, education_level, grade, country_code, detected_level, level_confidence, is_verified, created_at";
  const [meResult, followsResult, myInterestsResult, activePostsResult, recentUsersResult] = await Promise.all([
    db
      .from("users")
      .select("preferences, education_level, grade, country_code, detected_level, level_confidence")
      .eq("id", userId)
      .single(),
    db
      .from("user_follows")
      .select("following_id, created_at")
      .eq("follower_id", userId)
      .order("created_at", { ascending: false })
      .limit(500),
    db
      .from("user_topic_interests")
      .select("topic, interest_score")
      .eq("user_id", userId)
      .order("interest_score", { ascending: false })
      .limit(12),
    db
      .from("posts")
      .select("user_id, created_at")
      .neq("user_id", userId)
      .eq("visibility", "public")
      .order("created_at", { ascending: false })
      .limit(500),
    db
      .from("users")
      .select(userFields)
      .neq("id", userId)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  if (meResult.error) throw new AppError(meResult.error.message, 500);
  if (followsResult.error) throw new AppError(followsResult.error.message, 500);
  if (recentUsersResult.error) throw new AppError(recentUsersResult.error.message, 500);

  const me = meResult.data as any;
  const followedIds = new Set((followsResult.data ?? []).map((follow: any) => String(follow.following_id)));
  const followedList = Array.from(followedIds).slice(0, 100);

  // A second-degree connection is someone followed by a person I follow.
  // Shared-follow rows find people who follow at least one of the same people I do.
  const [secondDegreeResult, sharedFollowResult] = followedList.length > 0
    ? await Promise.all([
        db
          .from("user_follows")
          .select("follower_id, following_id")
          .in("follower_id", followedList)
          .limit(2000),
        db
          .from("user_follows")
          .select("follower_id, following_id")
          .in("following_id", followedList)
          .neq("follower_id", userId)
          .limit(2000),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  const secondDegreeCounts = new Map<string, number>();
  for (const relation of secondDegreeResult.data ?? []) {
    const candidateId = String((relation as any).following_id);
    if (candidateId === userId || followedIds.has(candidateId)) continue;
    secondDegreeCounts.set(candidateId, (secondDegreeCounts.get(candidateId) ?? 0) + 1);
  }

  const sharedFollowCounts = new Map<string, number>();
  for (const relation of sharedFollowResult.data ?? []) {
    const candidateId = String((relation as any).follower_id);
    if (candidateId === userId || followedIds.has(candidateId)) continue;
    sharedFollowCounts.set(candidateId, (sharedFollowCounts.get(candidateId) ?? 0) + 1);
  }

  const activityByUser = new Map<string, { lastActiveAt: number; postCount: number }>();
  for (const post of activePostsResult.error ? [] : (activePostsResult.data ?? [])) {
    const candidateId = String((post as any).user_id);
    if (followedIds.has(candidateId)) continue;
    const createdAt = new Date((post as any).created_at).getTime();
    const current = activityByUser.get(candidateId);
    activityByUser.set(candidateId, {
      lastActiveAt: Math.max(current?.lastActiveAt ?? 0, Number.isFinite(createdAt) ? createdAt : 0),
      postCount: (current?.postCount ?? 0) + 1,
    });
  }

  // Pull graph-connected and active accounts into the pool even when they are
  // older than the recent-user fallback window.
  const priorityIds = Array.from(new Set([
    ...Array.from(secondDegreeCounts.keys()),
    ...Array.from(sharedFollowCounts.keys()),
    ...Array.from(activityByUser.keys()),
  ])).filter(candidateId => candidateId !== userId && !followedIds.has(candidateId));

  const recentCandidates = (recentUsersResult.data ?? []) as any[];
  const recentIds = new Set(recentCandidates.map(candidate => String(candidate.id)));
  const missingPriorityIds = priorityIds.filter(candidateId => !recentIds.has(candidateId)).slice(0, 300);
  const priorityUserResults = await Promise.all(
    chunkSuggestionIds(missingPriorityIds, 100).map(candidateIds =>
      db.from("users").select(userFields).in("id", candidateIds)
    )
  );
  const priorityUsers = priorityUserResults.flatMap(result => result.error ? [] : (result.data ?? []));

  const candidateMap = new Map<string, any>();
  for (const candidate of [...recentCandidates, ...priorityUsers]) {
    const candidateId = String(candidate.id);
    if (candidateId !== userId && !followedIds.has(candidateId)) candidateMap.set(candidateId, candidate);
  }
  const candidates = Array.from(candidateMap.values());

  const myTopics = new Set(
    (myInterestsResult.error ? [] : (myInterestsResult.data ?? []))
      .map((interest: any) => normalizeSuggestionValue(interest.topic))
      .filter(Boolean)
  );
  const candidateTopicCounts = new Map<string, number>();
  if (myTopics.size > 0 && candidates.length > 0) {
    const candidateIdChunks = chunkSuggestionIds(candidates.map(candidate => String(candidate.id)), 100);
    const topicResults = await Promise.all(candidateIdChunks.map(candidateIds => db
      .from("user_topic_interests")
      .select("user_id, topic")
      .in("user_id", candidateIds)
    ));
    for (const result of topicResults) {
      if (result.error) continue;
      for (const interest of result.data ?? []) {
        if (!myTopics.has(normalizeSuggestionValue((interest as any).topic))) continue;
        const candidateId = String((interest as any).user_id);
        candidateTopicCounts.set(candidateId, (candidateTopicCounts.get(candidateId) ?? 0) + 1);
      }
    }
  }

  const mySubjects = new Set(suggestionSubjects(me?.preferences));
  const myLevel = suggestionLevel(me);
  const myGrade = normalizeSuggestionValue(me?.grade);
  const myCountry = normalizeSuggestionValue(me?.country_code);
  const now = Date.now();

  const ranked = candidates
    .map(candidate => {
      const candidateId = String(candidate.id);
      const theirSubjects = new Set(suggestionSubjects(candidate.preferences));
      const subjectOverlap = Array.from(mySubjects).filter(subject => theirSubjects.has(subject)).length;
      const topicOverlap = candidateTopicCounts.get(candidateId) ?? 0;
      const secondDegree = Math.min(secondDegreeCounts.get(candidateId) ?? 0, 3);
      const sharedFollows = Math.min(sharedFollowCounts.get(candidateId) ?? 0, 3);
      const sameGrade = Boolean(myGrade && myGrade === normalizeSuggestionValue(candidate.grade));
      const sameLevel = Boolean(myLevel && myLevel === suggestionLevel(candidate));
      const sameCountry = Boolean(myCountry && myCountry === normalizeSuggestionValue(candidate.country_code));
      const activity = activityByUser.get(candidateId);
      const ageDays = activity?.lastActiveAt ? (now - activity.lastActiveAt) / 86_400_000 : Number.POSITIVE_INFINITY;
      const recencyScore = ageDays <= 7 ? 4 : ageDays <= 30 ? 3 : ageDays <= 90 ? 1 : 0;
      const activityScore = recencyScore + Math.min(activity?.postCount ?? 0, 2);

      const score =
        secondDegree * 40 +
        sharedFollows * 20 +
        Math.min(subjectOverlap, 3) * 8 +
        Math.min(topicOverlap, 5) * 4 +
        (sameGrade ? 6 : 0) +
        (sameLevel ? 4 : 0) +
        (sameCountry ? 3 : 0) +
        activityScore;

      return {
        candidate,
        score,
        activityAt: activity?.lastActiveAt ?? 0,
        tieBreaker: suggestionTieBreaker(`${userId}:${candidateId}`),
      };
    })
    .sort((a, b) =>
      b.score - a.score ||
      b.activityAt - a.activityAt ||
      a.tieBreaker - b.tieBreaker
    )
    .slice(0, limit)
    .map(({ candidate }) => ({
      id: candidate.id,
      full_name: candidate.full_name,
      avatar_url: candidate.avatar_url ?? null,
      detected_level: candidate.detected_level ?? null,
      level_confidence: candidate.level_confidence ?? 0,
      is_verified: Boolean(candidate.is_verified),
    }));

  console.log("[suggestions] ranked", ranked.length, "from", candidates.length, "candidates", {
    following: followedIds.size,
    secondDegree: secondDegreeCounts.size,
    sharedFollows: sharedFollowCounts.size,
    active: activityByUser.size,
    subjects: mySubjects.size,
    topics: myTopics.size,
  });
  return ranked;
}

function normalizeSuggestionValue(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
}

function suggestionSubjects(preferences: unknown): string[] {
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) return [];
  const prefs = preferences as Record<string, unknown>;
  const values: string[] = [];
  for (const field of [prefs.subjects, prefs.preferred_subjects]) {
    if (Array.isArray(field)) values.push(...field.filter((value): value is string => typeof value === "string"));
  }
  if (prefs.math_interests && typeof prefs.math_interests === "object" && !Array.isArray(prefs.math_interests)) {
    values.push(...Object.entries(prefs.math_interests as Record<string, unknown>)
      .filter(([, weight]) => Number(weight) > 0)
      .map(([subject]) => subject));
  }
  return Array.from(new Set(values.map(normalizeSuggestionValue).filter(Boolean)));
}

function suggestionLevel(user: any): string {
  const educationLevel = normalizeSuggestionValue(user?.education_level);
  if (educationLevel && educationLevel !== "auto") return educationLevel;
  return Number(user?.level_confidence ?? 0) >= 0.6
    ? normalizeSuggestionValue(user?.detected_level)
    : "";
}

function chunkSuggestionIds(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size));
  return chunks;
}

function suggestionTieBreaker(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// ─── User search ─────────────────────────────────────────────────────────────

export type UserSearchResult = {
  id: string;
  full_name: string;
  username: string | null;
  avatar_url: string | null;
  education_level: string | null;
  detected_level: string | null;
  level_confidence: number;
  is_verified: boolean;
  is_following: boolean;
};

export async function searchUsers(
  userId: string,
  rawQuery: string,
  limit = 20
): Promise<UserSearchResult[]> {
  const db = getSupabaseAdmin();
  const query = rawQuery
    .trim()
    .slice(0, 50)
    .replace(/[^\p{L}\p{N}\s_.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (query.length < 2) return [];

  const resultLimit = Math.min(Math.max(limit, 1), 30);
  const pattern = `%${query}%`;

  // Search public display names and onboarding usernames independently, then
  // merge the results. Separate queries avoid building a user-controlled
  // PostgREST `or` expression.
  const [nameResult, usernameResult] = await Promise.all([
    db
      .from("users")
      .select("id, full_name, avatar_url, education_level, preferences, detected_level, level_confidence, is_verified")
      .neq("id", userId)
      .ilike("full_name", pattern)
      .limit(resultLimit),
    db
      .from("users")
      .select("id, full_name, avatar_url, education_level, preferences, detected_level, level_confidence, is_verified")
      .neq("id", userId)
      .ilike("preferences->>username", pattern)
      .limit(resultLimit),
  ]);

  if (nameResult.error) throw new AppError(nameResult.error.message, 500);
  // Older environments may not have preferences stored as jsonb. Name search
  // should remain available there instead of failing the whole request.
  const candidates = [...(nameResult.data ?? []), ...(usernameResult.error ? [] : (usernameResult.data ?? []))];
  const uniqueCandidates = Array.from(new Map(candidates.map((candidate: any) => [candidate.id, candidate])).values())
    .slice(0, resultLimit) as any[];

  if (uniqueCandidates.length === 0) return [];

  const candidateIds = uniqueCandidates.map(candidate => candidate.id);
  const { data: follows, error: followsError } = await db
    .from("user_follows")
    .select("following_id")
    .eq("follower_id", userId)
    .in("following_id", candidateIds);

  if (followsError) throw new AppError(followsError.message, 500);
  const followedIds = new Set((follows ?? []).map((follow: any) => follow.following_id));

  return uniqueCandidates.map((candidate: any) => ({
    id: candidate.id,
    full_name: candidate.full_name,
    username: candidate.preferences?.username?.trim() || null,
    avatar_url: candidate.avatar_url ?? null,
    education_level: candidate.education_level ?? null,
    detected_level: candidate.detected_level ?? null,
    level_confidence: candidate.level_confidence ?? 0,
    is_verified: Boolean(candidate.is_verified),
    is_following: followedIds.has(candidate.id),
  }));
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
