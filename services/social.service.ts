import { getSupabaseAdmin } from "../config/supabase.js";
import type { PublicProfile } from "../models/social.model.js";

export async function likePost(postId: string, userId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db.from("post_likes").insert({ post_id: postId, user_id: userId });
  if (error && error.code !== "23505") throw new Error(error.message); // ignore duplicate
}

export async function unlikePost(postId: string, userId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db.from("post_likes").delete().eq("post_id", postId).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function savePost(postId: string, userId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db.from("post_saves").insert({ post_id: postId, user_id: userId });
  if (error && error.code !== "23505") throw new Error(error.message);
}

export async function unsavePost(postId: string, userId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db.from("post_saves").delete().eq("post_id", postId).eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function followUser(followerId: string, followingId: string): Promise<void> {
  if (followerId === followingId) throw new Error("Cannot follow yourself");
  const db = getSupabaseAdmin();
  const { error } = await db.from("user_follows").insert({ follower_id: followerId, following_id: followingId });
  if (error && error.code !== "23505") throw new Error(error.message);
}

export async function unfollowUser(followerId: string, followingId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db.from("user_follows").delete().eq("follower_id", followerId).eq("following_id", followingId);
  if (error) throw new Error(error.message);
}

export async function getPublicProfile(targetUserId: string, requestingUserId?: string): Promise<PublicProfile | null> {
  const db = getSupabaseAdmin();
  const { data: user, error } = await db
    .from("users")
    .select("id, full_name, avatar_url, grade, education_level, detected_level, level_confidence, preferences")
    .eq("id", targetUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!user) return null;

  const prefs = (user.preferences as Record<string, any>) ?? {};

  const isOwner = requestingUserId === targetUserId;
  const followRes = !isOwner && requestingUserId
    ? await db.from("user_follows").select("follower_id").eq("follower_id", requestingUserId).eq("following_id", targetUserId).maybeSingle()
    : { data: null, error: null };
  if (followRes.error) throw new Error(followRes.error.message);
  const visiblePostTypes = isOwner || followRes.data ? ["public", "followers"] : ["public"];
  const visibleCount = (type: string) => db
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", targetUserId)
    .eq("type", type)
    .in("visibility", visiblePostTypes);

  const [solutionRes, questionRes, resourceRes, topInterestsRes, topicInterestCountRes] = await Promise.all([
    visibleCount("solution"),
    visibleCount("question"),
    visibleCount("resource"),
    db
      .from("user_topic_interests")
      .select("topic, interest_score")
      .eq("user_id", targetUserId)
      .order("interest_score", { ascending: false })
      .limit(5),
    db
      .from("user_topic_interests")
      .select("topic", { count: "exact", head: true })
      .eq("user_id", targetUserId),
  ]);

  return {
    id: user.id,
    full_name: user.full_name,
    avatar_url: user.avatar_url ?? null,
    grade: user.grade ?? null,
    education_level: (user as any).education_level ?? null,
    detected_level: (user as any).detected_level ?? null,
    level_confidence: (user as any).level_confidence ?? 0,
    bio: prefs.bio ?? null,
    solution_count: solutionRes.count ?? 0,
    question_count: questionRes.count ?? 0,
    resource_count: resourceRes.count ?? 0,
    top_interests: (topInterestsRes.data ?? []).map((interest: any) => ({
      topic: String(interest.topic),
      interest_score: Number(interest.interest_score) || 0,
    })),
    topic_interest_count: topicInterestCountRes.count ?? 0,
    math_interests: prefs.math_interests ?? {},
    learning_goals: prefs.learning_goals ?? null,
    is_following: !isOwner && !!followRes.data,
  };
}
