import { getSupabaseAdmin } from "../config/supabase.js";
import type { Post, PostFeedItem, CreatePostDTO } from "../models/post.model.js";
import { moderateContent } from "./moderation.service.js";
import { detectAndUpdateLevel } from "./level-detection.service.js";
import { detectAndTagTopic } from "./topic-detection.service.js";
import { logger } from "../utils/logger.js";
import { ValidationError } from "../api/middlewares/error.middleware.js";

const MAX_IMAGE_OCR_TEXT_CHARS = 4000;
const OWN_POST_PIN_WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_PINNED_OWN_POSTS = 2;

export async function createPost(userId: string, dto: CreatePostDTO): Promise<Post> {
  const db = getSupabaseAdmin();
  const imageOcrText = normalizeImageOcrText(dto.image_ocr_text);
  let collectionText = "";

  if (dto.session_id) {
    if (dto.type !== "solution") {
      throw new ValidationError("session_id is only valid for a solution post.");
    }
    const session = await db
      .from("study_sessions")
      .select("id")
      .eq("id", dto.session_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (session.error) throw new Error(session.error.message);
    if (!session.data) {
      throw new ValidationError("You can only share a solution session you own.");
    }
  }

  if (dto.type === "collection") {
    if (!dto.collection_id) {
      throw new ValidationError("collection_id is required for a collection post.");
    }
    if ((dto.visibility ?? "public") !== "public") {
      throw new ValidationError("Collection posts must be public.");
    }
    const collection = await db
      .from("archive_collections")
      .select("id,name,description")
      .eq("id", dto.collection_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (collection.error) throw new Error(collection.error.message);
    if (!collection.data) throw new ValidationError("You can only share a collection you own.");
    collectionText = [collection.data.name, collection.data.description].filter(Boolean).join(" ");
  }

  // Moderate the text content before saving
  const textToModerate = [dto.caption, dto.topic, imageOcrText, collectionText].filter(Boolean).join(" ");
  if (textToModerate.trim()) {
    const mod = await moderateContent(textToModerate, "post", "pending", {
      // Ownership was verified above, so the collection itself provides the
      // educational context. Captions may be conversational while every other
      // moderation category remains enforced.
      allowOffTopic: dto.type === "collection",
    });
    if (!mod.allowed) {
      const err = new Error(mod.reason ?? "Your post violates our community guidelines.") as any;
      err.statusCode = 422;
      throw err;
    }
  }

  const { data, error } = await db
    .from("posts")
    .insert({
      user_id: userId,
      session_id: dto.session_id ?? null,
      collection_id: dto.type === "collection" ? dto.collection_id : null,
      type: dto.type,
      visibility: dto.visibility ?? "public",
      topic: dto.topic ?? null,
      grade: dto.grade ?? null,
      caption: dto.caption ?? null,
      image_url: dto.image_url ?? null,
      image_ocr_text: imageOcrText,
      file_url: dto.file_url ?? null,
      file_name: dto.file_name ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  const post = data as Post;
  if (dto.type === "collection") {
    const published = await db
      .from("archive_collections")
      .update({ visibility: "public" })
      .eq("id", dto.collection_id!)
      .eq("user_id", userId);
    if (published.error) {
      await db.from("posts").delete().eq("id", post.id).eq("user_id", userId);
      throw new Error(published.error.message);
    }
  }

  const contentText = [dto.caption, dto.topic, imageOcrText, collectionText].filter(Boolean).join(" ");

  // Fire-and-forget: detect user level + auto-tag topic (never block the response)
  if (contentText.trim()) {
    detectAndUpdateLevel(userId, contentText).catch(() => {});
  }
  if (!post.topic && contentText.trim()) {
    logger.debug("[post-create] queued topic detection", {
      postId: post.id,
      userId,
      preview: contentText.slice(0, 120),
    });
    detectAndTagTopic(post.id, contentText).catch(() => {});
  } else if (post.topic) {
    logger.debug("[post-create] topic provided at creation", {
      postId: post.id,
      userId,
      topic: post.topic,
    });
  }

  return post;
}

export async function deletePost(postId: string, userId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("posts")
    .delete()
    .eq("id", postId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function getPostById(postId: string, requestingUserId?: string): Promise<PostFeedItem | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("posts")
    .select(`
      *,
      users!posts_user_id_fkey (id, full_name, avatar_url, grade),
      study_sessions!posts_session_id_fkey (problem, image_url, breakdown_json),
      archive_collections!posts_collection_id_fkey (id, name, description, color, icon, visibility, archive_collection_items(count))
    `)
    .eq("id", postId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  let is_liked = false;
  let is_saved = false;
  if (requestingUserId) {
    const [likeRes, saveRes] = await Promise.all([
      db.from("post_likes").select("post_id").eq("post_id", postId).eq("user_id", requestingUserId).maybeSingle(),
      db.from("post_saves").select("post_id").eq("post_id", postId).eq("user_id", requestingUserId).maybeSingle(),
    ]);
    is_liked = !!likeRes.data;
    is_saved = !!saveRes.data;
  }

  return buildFeedItem(data, is_liked, is_saved);
}

export async function getForYouFeed(
  userId: string,
  opts: { cursor?: string; topic?: string; limit?: number }
): Promise<PostFeedItem[]> {
  const db = getSupabaseAdmin();
  const limit = opts.limit ?? 15;
  const candidateLimit = Math.max(limit * 5, 50);
  const newestCandidateDate = new Date();
  newestCandidateDate.setDate(newestCandidateDate.getDate() - 14);

  let query = db
    .from("posts")
    .select(`
      *,
      users!posts_user_id_fkey (id, full_name, avatar_url, grade, reputation_score),
      study_sessions!posts_session_id_fkey (problem, image_url, breakdown_json),
      archive_collections!posts_collection_id_fkey (id, name, description, color, icon, visibility, archive_collection_items(count))
    `)
    .eq("visibility", "public")
    .gte("created_at", newestCandidateDate.toISOString())
    .order("created_at", { ascending: false })
    .limit(candidateLimit);

  if (opts.topic) query = query.eq("topic", opts.topic);
  if (opts.cursor) query = query.lt("created_at", opts.cursor);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (!data?.length) return [];

  // Batch fetch like/save state
  const postIds = data.map((p: any) => p.id);
  const authorIds = Array.from(new Set(data.map((p: any) => p.user_id).filter(Boolean)));
  const [likesRes, savesRes, userRes, interestsRes, followsRes] = await Promise.all([
    db.from("post_likes").select("post_id").eq("user_id", userId).in("post_id", postIds),
    db.from("post_saves").select("post_id").eq("user_id", userId).in("post_id", postIds),
    db.from("users").select("detected_level, grade, preferences").eq("id", userId).maybeSingle(),
    db.from("user_topic_interests").select("topic, interest_score").eq("user_id", userId),
    authorIds.length
      ? db.from("user_follows").select("following_id").eq("follower_id", userId).in("following_id", authorIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  const likedIds = new Set((likesRes.data ?? []).map((r: any) => r.post_id));
  const savedIds = new Set((savesRes.data ?? []).map((r: any) => r.post_id));
  const followingIds = new Set((followsRes.data ?? []).map((r: any) => r.following_id));
  const userProfile = (userRes.data ?? {}) as {
    detected_level?: string | null;
    grade?: string | null;
    preferences?: unknown;
  };
  const topicAffinity = buildTopicAffinityMap(interestsRes.data ?? [], userProfile.preferences);
  const userLevel =
    normalizeLevel(userProfile.detected_level) ??
    preferenceFeedLevel(userProfile.preferences) ??
    normalizeLevel(userProfile.grade);
  const maxReputation = Math.max(
    1,
    ...data.map((p: any) => Number(p.users?.reputation_score ?? 0)).filter((score: number) => Number.isFinite(score))
  );
  const maxEngagementRate = Math.max(1, ...data.map((p: any) => engagementRate(p)));

  const scored = data.map((post: any) => ({
    post,
    score: scorePost(post, {
      topicAffinity,
      userLevel,
      followingIds,
      maxReputation,
      maxEngagementRate,
    }),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.post.created_at).getTime() - new Date(a.post.created_at).getTime();
  });

  // On the first page, keep the requester's newly published posts visible at
  // the top of their own feed. This is deliberately viewer-specific: those
  // posts continue through normal personalized ranking for everyone else.
  // The two-hour window matches the feed's existing "fresh post" policy and
  // prevents old self-authored posts from being permanently pinned.
  const pinnedOwn = opts.cursor
    ? []
    : scored
        .filter(({ post }) =>
          post.user_id === userId &&
          Date.now() - new Date(post.created_at).getTime() <= OWN_POST_PIN_WINDOW_MS
        )
        .sort((a, b) => new Date(b.post.created_at).getTime() - new Date(a.post.created_at).getTime())
        .slice(0, MAX_PINNED_OWN_POSTS);

  const pinnedIds = new Set(pinnedOwn.map(({ post }) => post.id));
  const initialAuthorCounts = new Map<string, number>();
  if (pinnedOwn.length) initialAuthorCounts.set(userId, pinnedOwn.length);
  let remainingOwnSlots = Math.max(0, 2 - pinnedOwn.length);
  const unpinnedCandidates = scored.filter(({ post }) => {
    if (pinnedIds.has(post.id)) return false;
    if (post.user_id !== userId) return true;
    if (remainingOwnSlots === 0) return false;
    remainingOwnSlots -= 1;
    return true;
  });
  const rankedRemainder = diversifyByAuthor(
    unpinnedCandidates,
    Math.max(0, limit - pinnedOwn.length),
    initialAuthorCounts,
  );
  const diversified = [...pinnedOwn, ...rankedRemainder].map(({ post }) => post);
  return diversified.map((p: any) => buildFeedItem(p, likedIds.has(p.id), savedIds.has(p.id)));
}

export async function getFollowingFeed(
  userId: string,
  opts: { cursor?: string; limit?: number }
): Promise<PostFeedItem[]> {
  const db = getSupabaseAdmin();
  const limit = opts.limit ?? 15;

  // Get IDs of users we follow
  const { data: follows } = await db
    .from("user_follows")
    .select("following_id")
    .eq("follower_id", userId);
  const followingIds = (follows ?? []).map((f: any) => f.following_id);
  if (followingIds.length === 0) return [];

  let query = db
    .from("posts")
    .select(`
      *,
      users!posts_user_id_fkey (id, full_name, avatar_url, grade),
      study_sessions!posts_session_id_fkey (problem, image_url, breakdown_json),
      archive_collections!posts_collection_id_fkey (id, name, description, color, icon, visibility, archive_collection_items(count))
    `)
    .in("user_id", followingIds)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (opts.cursor) query = query.lt("created_at", opts.cursor);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const postIds = (data ?? []).map((p: any) => p.id);
  const [likesRes, savesRes] = await Promise.all([
    db.from("post_likes").select("post_id").eq("user_id", userId).in("post_id", postIds),
    db.from("post_saves").select("post_id").eq("user_id", userId).in("post_id", postIds),
  ]);
  const likedIds = new Set((likesRes.data ?? []).map((r: any) => r.post_id));
  const savedIds = new Set((savesRes.data ?? []).map((r: any) => r.post_id));

  return (data ?? []).map((p: any) => buildFeedItem(p, likedIds.has(p.id), savedIds.has(p.id)));
}

export async function getMyPosts(
  userId: string,
  opts: { cursor?: string; limit?: number }
): Promise<PostFeedItem[]> {
  const db = getSupabaseAdmin();
  const limit = opts.limit ?? 10;

  let query = db
    .from("posts")
    .select(`
      *,
      users!posts_user_id_fkey (id, full_name, avatar_url, grade),
      study_sessions!posts_session_id_fkey (problem, image_url, breakdown_json),
      archive_collections!posts_collection_id_fkey (id, name, description, color, icon, visibility, archive_collection_items(count))
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (opts.cursor) query = query.lt("created_at", opts.cursor);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (!data?.length) return [];

  const postIds = data.map((post: any) => post.id);
  const [likesRes, savesRes] = await Promise.all([
    db.from("post_likes").select("post_id").eq("user_id", userId).in("post_id", postIds),
    db.from("post_saves").select("post_id").eq("user_id", userId).in("post_id", postIds),
  ]);
  const likedIds = new Set((likesRes.data ?? []).map((row: any) => row.post_id));
  const savedIds = new Set((savesRes.data ?? []).map((row: any) => row.post_id));

  return data.map((post: any) => buildFeedItem(post, likedIds.has(post.id), savedIds.has(post.id)));
}

export async function getUserPosts(
  targetUserId: string,
  requestingUserId: string,
  opts: { cursor?: string; limit?: number }
): Promise<PostFeedItem[]> {
  const db = getSupabaseAdmin();
  const limit = opts.limit ?? 10;
  const isOwner = targetUserId === requestingUserId;

  let canSeeFollowerPosts = isOwner;
  if (!isOwner) {
    const follow = await db
      .from("user_follows")
      .select("following_id")
      .eq("follower_id", requestingUserId)
      .eq("following_id", targetUserId)
      .maybeSingle();
    if (follow.error) throw new Error(follow.error.message);
    canSeeFollowerPosts = !!follow.data;
  }

  let query = db
    .from("posts")
    .select(`
      *,
      users!posts_user_id_fkey (id, full_name, avatar_url, grade),
      study_sessions!posts_session_id_fkey (problem, image_url, breakdown_json),
      archive_collections!posts_collection_id_fkey (id, name, description, color, icon, visibility, archive_collection_items(count))
    `)
    .eq("user_id", targetUserId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!isOwner) {
    query = canSeeFollowerPosts
      ? query.in("visibility", ["public", "followers"])
      : query.eq("visibility", "public");
  }
  if (opts.cursor) query = query.lt("created_at", opts.cursor);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (!data?.length) return [];

  const postIds = data.map((post: any) => post.id);
  const [likesRes, savesRes] = await Promise.all([
    db.from("post_likes").select("post_id").eq("user_id", requestingUserId).in("post_id", postIds),
    db.from("post_saves").select("post_id").eq("user_id", requestingUserId).in("post_id", postIds),
  ]);
  const likedIds = new Set((likesRes.data ?? []).map((row: any) => row.post_id));
  const savedIds = new Set((savesRes.data ?? []).map((row: any) => row.post_id));

  return data.map((post: any) => buildFeedItem(post, likedIds.has(post.id), savedIds.has(post.id)));
}

export async function getSavedPosts(
  userId: string,
  opts: { cursor?: string; type?: string; limit?: number }
): Promise<PostFeedItem[]> {
  const db = getSupabaseAdmin();
  const limit = opts.limit ?? 15;

  let query = db
    .from("post_saves")
    .select(`
      created_at,
      posts (
        *,
        users!posts_user_id_fkey (id, full_name, avatar_url, grade),
        study_sessions!posts_session_id_fkey (problem, image_url, breakdown_json),
        archive_collections!posts_collection_id_fkey (id, name, description, color, icon, visibility, archive_collection_items(count))
      )
    `)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (opts.cursor) query = query.lt("created_at", opts.cursor);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((r: any) => r.posts)
    .map((r: any) => buildFeedItem(r.posts, false, true));
}

// ─── Interaction tracking ─────────────────────────────────────────────────────

export type InteractionEventType = "view" | "like" | "save" | "comment" | "share";

export async function logInteraction(
  userId: string,
  postId: string,
  eventType: InteractionEventType,
  durationMs?: number
): Promise<void> {
  const db = getSupabaseAdmin();
  await db
    .from("user_post_interactions")
    .upsert(
      { user_id: userId, post_id: postId, event_type: eventType, duration_ms: durationMs ?? null, created_at: new Date().toISOString() },
      { onConflict: "user_id,post_id,event_type" }
    );
  // Errors are silently swallowed — interaction logging must never break the main flow
}

// ─── Personalized ranking ────────────────────────────────────────────────────

type FeedScoringContext = {
  topicAffinity: Map<string, number>;
  userLevel: string | null;
  followingIds: Set<string>;
  maxReputation: number;
  maxEngagementRate: number;
};

function scorePost(post: any, context: FeedScoringContext): number {
  const authorReputation = clamp01(Number(post.users?.reputation_score ?? 0) / context.maxReputation);
  const levelMatch = context.userLevel && normalizeLevel(post.grade) === context.userLevel ? 1 : 0;
  const topicAffinity = post.topic ? context.topicAffinity.get(normalizeTopic(post.topic)) ?? 0 : 0;
  const engagement = clamp01(engagementRate(post) / context.maxEngagementRate);

  return (
    recencyScore(post.created_at) * 1.0 +
    topicAffinity * 2.0 +
    levelMatch * 0.8 +
    (context.followingIds.has(post.user_id) ? 1.2 : 0) +
    engagement * 0.8 +
    authorReputation * 0.5 +
    (post.verified ? 0.3 : 0)
  );
}

function recencyScore(createdAt: string): number {
  const ageMs = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const hours = ageMs / (1000 * 60 * 60);
  return Math.exp(-hours / 48);
}

function engagementRate(post: any): number {
  const ageMs = Math.max(0, Date.now() - new Date(post.created_at).getTime());
  const hours = ageMs / (1000 * 60 * 60);
  const engagement =
    Number(post.like_count ?? 0) +
    Number(post.save_count ?? 0) * 2 +
    Number(post.comment_count ?? 0) * 1.5;
  return engagement / (hours + 1);
}

function buildTopicAffinityMap(rows: any[], preferences: unknown): Map<string, number> {
  const scores = new Map<string, number>();
  for (const row of rows) {
    if (!row.topic) continue;
    scores.set(normalizeTopic(row.topic), Number(row.interest_score ?? 0));
  }

  if (scores.size === 0) {
    for (const subject of preferredSubjects(preferences)) {
      scores.set(normalizeTopic(subject), 1);
    }
  }

  const maxScore = Math.max(1, ...Array.from(scores.values()));
  for (const [topic, score] of scores) {
    scores.set(topic, clamp01(score / maxScore));
  }
  return scores;
}

function preferredSubjects(preferences: unknown): string[] {
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) return [];
  const prefs = preferences as Record<string, unknown>;
  const rawSubjects = prefs.subjects ?? prefs.preferred_subjects ?? prefs.math_interests;
  if (Array.isArray(rawSubjects)) return rawSubjects.filter((subject): subject is string => typeof subject === "string");
  if (rawSubjects && typeof rawSubjects === "object") {
    return Object.entries(rawSubjects as Record<string, unknown>)
      .filter(([, value]) => Boolean(value))
      .map(([key]) => key);
  }
  return [];
}

function preferenceFeedLevel(preferences: unknown): string | null {
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) return null;
  const level = (preferences as Record<string, unknown>).feed_level;
  if (level === "auto") return null;
  return normalizeLevel(level);
}

function diversifyByAuthor<T extends { post: any; score: number }>(
  scored: T[],
  limit: number,
  initialAuthorCounts: Map<string, number> = new Map(),
): T[] {
  const selected: T[] = [];
  const deferred: T[] = [];
  const authorCounts = new Map(initialAuthorCounts);

  for (const item of scored) {
    const authorId = String(item.post.user_id ?? "");
    const count = authorCounts.get(authorId) ?? 0;
    if (count < 2) {
      selected.push(item);
      authorCounts.set(authorId, count + 1);
    } else {
      deferred.push(item);
    }
    if (selected.length === limit) return selected;
  }

  return selected.concat(deferred).slice(0, limit);
}

function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase();
}

function normalizeLevel(level: unknown): string | null {
  if (typeof level !== "string") return null;
  return level.trim().toLowerCase().replace(/\s+/g, "_") || null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// ─── Feed item builder ────────────────────────────────────────────────────────

function buildFeedItem(raw: any, is_liked: boolean, is_saved: boolean): PostFeedItem {
  const session = raw.study_sessions ?? null;
  const collection = raw.archive_collections ?? null;
  const author = raw.users ?? {};
  return {
    id: raw.id,
    user_id: raw.user_id,
    session_id: raw.session_id,
    collection_id: raw.collection_id ?? null,
    type: raw.type,
    visibility: raw.visibility,
    topic: raw.topic,
    grade: raw.grade,
    verified: raw.verified,
    like_count: raw.like_count ?? 0,
    comment_count: raw.comment_count ?? 0,
    save_count: raw.save_count ?? 0,
    created_at: raw.created_at,
    author: {
      id: author.id,
      full_name: author.full_name,
      avatar_url: author.avatar_url ?? null,
      grade: author.grade ?? null,
    },
    caption: raw.caption ?? null,
    problem: session?.problem ?? null,
    image_url: raw.image_url ?? session?.image_url ?? null,
    image_ocr_text: raw.image_ocr_text ?? null,
    file_url: raw.file_url ?? null,
    file_name: raw.file_name ?? null,
    breakdown_json: session?.breakdown_json ?? null,
    collection: collection ? {
      id: collection.id,
      name: collection.name,
      description: collection.description ?? null,
      color: collection.color ?? "#2563FF",
      icon: collection.icon ?? null,
      item_count: Number(collection.archive_collection_items?.[0]?.count ?? 0),
    } : null,
    is_liked,
    is_saved,
  };
}

function normalizeImageOcrText(text?: string | null): string | null {
  const normalized = text?.trim().replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n");
  return normalized ? normalized.slice(0, MAX_IMAGE_OCR_TEXT_CHARS) : null;
}
