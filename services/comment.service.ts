import { getSupabaseAdmin } from "../config/supabase.js";
import type { CommentWithAuthor, CreateCommentDTO } from "../models/comment.model.js";
import { moderateContent } from "./moderation.service.js";
import { AppError } from "../api/middlewares/error.middleware.js";

export async function getComments(
  postId: string,
  opts: { cursor?: string; limit?: number }
): Promise<CommentWithAuthor[]> {
  const db = getSupabaseAdmin();
  const limit = opts.limit ?? 20;

  let query = db
    .from("post_comments")
    .select(`*, users!post_comments_user_id_fkey (id, full_name, avatar_url, grade)`)
    .eq("post_id", postId)
    .is("parent_id", null) // top-level only for now
    .order("created_at", { ascending: true })
    .limit(limit);

  if (opts.cursor) query = query.gt("created_at", opts.cursor);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((c: any) => ({
    id: c.id,
    post_id: c.post_id,
    user_id: c.user_id,
    parent_id: c.parent_id,
    content: c.content,
    created_at: c.created_at,
    author: {
      id: c.users.id,
      full_name: c.users.full_name,
      avatar_url: c.users.avatar_url ?? null,
      grade: c.users.grade ?? null,
    },
  }));
}

export async function createComment(
  postId: string,
  userId: string,
  dto: CreateCommentDTO
): Promise<CommentWithAuthor> {
  // Moderate comment text before saving
  const mod = await moderateContent(dto.content, "comment");
  if (!mod.allowed) {
    throw new AppError(mod.reason ?? "Your comment violates our community guidelines.", 422);
  }

  const db = getSupabaseAdmin();
  const { data: comment, error } = await db
    .from("post_comments")
    .insert({ post_id: postId, user_id: userId, content: dto.content, parent_id: dto.parent_id ?? null })
    .select(`*, users!post_comments_user_id_fkey (id, full_name, avatar_url, grade)`)
    .single();
  if (error) throw new Error(error.message);
  return {
    id: comment.id,
    post_id: comment.post_id,
    user_id: comment.user_id,
    parent_id: comment.parent_id,
    content: comment.content,
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
