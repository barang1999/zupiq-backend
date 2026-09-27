import { getSupabaseAdmin } from "../config/supabase.js";
import type { CommentWithAuthor, CreateCommentDTO } from "../models/comment.model.js";
import { moderateContent } from "./moderation.service.js";
import { AppError } from "../api/middlewares/error.middleware.js";

export async function getComments(
  postId: string,
  userId: string,
  opts: { cursor?: string; limit?: number }
): Promise<CommentWithAuthor[]> {
  const db = getSupabaseAdmin();
  const limit = opts.limit ?? 20;

  let query = db
    .from("post_comments")
    .select(`*, users!post_comments_user_id_fkey (id, full_name, avatar_url, grade)`)
    .eq("post_id", postId)
    .is("parent_id", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (opts.cursor) query = query.gt("created_at", opts.cursor);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const comments = data ?? [];
  const commentIds = comments.map((c: any) => c.id);

  // Batch fetch liked comment ids for this user
  let likedIds = new Set<string>();
  if (commentIds.length > 0) {
    const { data: likes } = await db
      .from("comment_likes")
      .select("comment_id")
      .eq("user_id", userId)
      .in("comment_id", commentIds);
    likedIds = new Set((likes ?? []).map((l: any) => l.comment_id));
  }

  return comments.map((c: any) => ({
    id: c.id,
    post_id: c.post_id,
    user_id: c.user_id,
    parent_id: c.parent_id,
    image_url: c.image_url ?? null,
    content: c.content,
    like_count: c.like_count ?? 0,
    reply_count: c.reply_count ?? 0,
    is_liked: likedIds.has(c.id),
    created_at: c.created_at,
    author: {
      id: c.users.id,
      full_name: c.users.full_name,
      avatar_url: c.users.avatar_url ?? null,
      grade: c.users.grade ?? null,
    },
  }));
}

export async function getReplies(
  commentId: string,
  userId: string
): Promise<CommentWithAuthor[]> {
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("post_comments")
    .select(`*, users!post_comments_user_id_fkey (id, full_name, avatar_url, grade)`)
    .eq("parent_id", commentId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  const replies = data ?? [];
  const replyIds = replies.map((r: any) => r.id);

  let likedIds = new Set<string>();
  if (replyIds.length > 0) {
    const { data: likes } = await db
      .from("comment_likes")
      .select("comment_id")
      .eq("user_id", userId)
      .in("comment_id", replyIds);
    likedIds = new Set((likes ?? []).map((l: any) => l.comment_id));
  }

  return replies.map((r: any) => ({
    id: r.id,
    post_id: r.post_id,
    user_id: r.user_id,
    parent_id: r.parent_id,
    image_url: r.image_url ?? null,
    content: r.content,
    like_count: r.like_count ?? 0,
    reply_count: 0,
    is_liked: likedIds.has(r.id),
    created_at: r.created_at,
    author: {
      id: r.users.id,
      full_name: r.users.full_name,
      avatar_url: r.users.avatar_url ?? null,
      grade: r.users.grade ?? null,
    },
  }));
}

export async function likeComment(commentId: string, userId: string): Promise<void> {
  const db = getSupabaseAdmin();
  await db.from("comment_likes").insert({ user_id: userId, comment_id: commentId });
}

export async function unlikeComment(commentId: string, userId: string): Promise<void> {
  const db = getSupabaseAdmin();
  await db.from("comment_likes").delete().eq("user_id", userId).eq("comment_id", commentId);
}

export async function createComment(
  postId: string,
  userId: string,
  dto: CreateCommentDTO
): Promise<CommentWithAuthor> {
  // Moderate comment text before saving
  const mod = await moderateContent(dto.content, "comment", "pending", { allowOffTopic: true });
  if (!mod.allowed) {
    throw new AppError(mod.reason ?? "Your comment violates our community guidelines.", 422);
  }

  const db = getSupabaseAdmin();
  const { data: comment, error } = await db
    .from("post_comments")
    .insert({ post_id: postId, user_id: userId, content: dto.content, parent_id: dto.parent_id ?? null, image_url: dto.image_url ?? null })
    .select(`*, users!post_comments_user_id_fkey (id, full_name, avatar_url, grade)`)
    .single();
  if (error) throw new Error(error.message);
  return {
    id: comment.id,
    post_id: comment.post_id,
    user_id: comment.user_id,
    parent_id: comment.parent_id,
    image_url: comment.image_url ?? null,
    content: comment.content,
    like_count: comment.like_count ?? 0,
    reply_count: comment.reply_count ?? 0,
    is_liked: false,
    created_at: comment.created_at,
    author: {
      id: comment.users.id,
      full_name: comment.users.full_name,
      avatar_url: comment.users.avatar_url ?? null,
      grade: comment.users.grade ?? null,
    },
  };
}

export async function deleteComment(commentId: string, userId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("post_comments")
    .delete()
    .eq("id", commentId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}
