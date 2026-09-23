import { getSupabaseAdmin } from "../config/supabase.js";
import type { Resource, ResourceWithAuthor, CreateResourceDTO } from "../models/resource.model.js";

export async function createResource(
  userId: string,
  postId: string,
  dto: CreateResourceDTO
): Promise<Resource> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("resources")
    .insert({
      user_id: userId,
      post_id: postId,
      title: dto.title,
      description: dto.description ?? null,
      file_url: dto.file_url ?? null,
      file_type: dto.file_type ?? null,
      tags: dto.tags ?? [],
      topic: dto.topic ?? null,
      grade: dto.grade ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Resource;
}

export async function getResourceFeed(opts: {
  cursor?: string;
  topic?: string;
  limit?: number;
}): Promise<ResourceWithAuthor[]> {
  const db = getSupabaseAdmin();
  const limit = opts.limit ?? 15;

  let query = db
    .from("resources")
    .select(`
      *,
      users!resources_user_id_fkey (id, full_name, avatar_url, grade),
      posts!resources_post_id_fkey (like_count, comment_count)
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (opts.topic) query = query.eq("topic", opts.topic);
  if (opts.cursor) query = query.lt("created_at", opts.cursor);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((r: any) => ({
    ...r,
    author: { id: r.users.id, full_name: r.users.full_name, avatar_url: r.users.avatar_url ?? null, grade: r.users.grade ?? null },
    post_like_count: r.posts?.like_count ?? 0,
    post_comment_count: r.posts?.comment_count ?? 0,
  }));
}

export async function getResourceById(resourceId: string): Promise<ResourceWithAuthor | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("resources")
    .select(`
      *,
      users!resources_user_id_fkey (id, full_name, avatar_url, grade),
      posts!resources_post_id_fkey (like_count, comment_count)
    `)
    .eq("id", resourceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    ...data,
    author: { id: data.users.id, full_name: data.users.full_name, avatar_url: data.users.avatar_url ?? null, grade: data.users.grade ?? null },
    post_like_count: data.posts?.like_count ?? 0,
    post_comment_count: data.posts?.comment_count ?? 0,
  };
}

export async function incrementDownload(resourceId: string): Promise<string | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.rpc("increment_resource_download", { resource_id: resourceId });
  if (error) {
    // Fallback: manual increment
    const { data: r } = await db.from("resources").select("file_url, download_count").eq("id", resourceId).single();
    if (r) {
      await db.from("resources").update({ download_count: (r.download_count ?? 0) + 1 }).eq("id", resourceId);
      return r.file_url;
    }
  }
  const { data: r2 } = await db.from("resources").select("file_url").eq("id", resourceId).single();
  return r2?.file_url ?? null;
}
