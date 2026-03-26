import { getSupabaseAdmin } from "../config/supabase.js";
import {
  Group,
  GroupMember,
  GroupPost,
  CreateGroupDTO,
  UpdateGroupDTO,
  CreateGroupPostDTO,
} from "../models/group.model.js";
import { generateId, generateInviteCode, nowISO } from "../utils/helpers.js";
import { AppError, NotFoundError, ForbiddenError } from "../api/middlewares/error.middleware.js";

// ─── Groups CRUD ──────────────────────────────────────────────────────────────

export async function createGroup(ownerId: string, dto: CreateGroupDTO): Promise<Group> {
  const db = getSupabaseAdmin();
  const id = generateId();
  const inviteCode = generateInviteCode();

  const { error } = await db.from("groups").insert({
    id,
    name: dto.name,
    description: dto.description ?? null,
    subject: dto.subject ?? null,
    owner_id: ownerId,
    invite_code: inviteCode,
    is_public: dto.is_public !== false,
    max_members: dto.max_members ?? 50,
    created_at: nowISO(),
    updated_at: nowISO(),
  });

  if (error) throw new AppError(error.message, 500);

  // Add owner as first member with 'owner' role
  await addMember(id, ownerId, "owner");

  const group = await getGroupById(id);
  if (!group) throw new AppError("Failed to create group", 500);
  return group;
}

export async function getGroupById(id: string): Promise<Group | null> {
  const db = getSupabaseAdmin();

  const { data: group, error } = await db
    .from("groups")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !group) return null;

  // Get member count separately
  const { count } = await db
    .from("group_members")
    .select("id", { count: "exact", head: true })
    .eq("group_id", id);

  return { ...(group as Group), member_count: count ?? 0 };
}

export async function listPublicGroups(params: { page?: number; limit?: number; subject?: string } = {}): Promise<Group[]> {
  const db = getSupabaseAdmin();
  const limit = params.limit ?? 20;
  const offset = ((params.page ?? 1) - 1) * limit;

  let query = db
    .from("groups")
    .select("*")
    .eq("is_public", true)
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (params.subject) {
    query = query.eq("subject", params.subject);
  }

  const { data, error } = await query;
  if (error) throw new AppError(error.message, 500);

  // Fetch member counts for all groups
  const groups = (data as Group[]);
  const groupIds = groups.map((g) => g.id);

  if (groupIds.length === 0) return [];

  const { data: memberCounts } = await db
    .from("group_members")
    .select("group_id")
    .in("group_id", groupIds);

  const countMap: Record<string, number> = {};
  for (const row of memberCounts ?? []) {
    countMap[row.group_id] = (countMap[row.group_id] ?? 0) + 1;
  }

  return groups.map((g) => ({ ...g, member_count: countMap[g.id] ?? 0 }));
}

export async function getUserGroups(userId: string): Promise<Group[]> {
  const db = getSupabaseAdmin();

  // Get group IDs the user is a member of
  const { data: memberships, error: memberError } = await db
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId);

  if (memberError) throw new AppError(memberError.message, 500);
  if (!memberships || memberships.length === 0) return [];

  const groupIds = memberships.map((m) => m.group_id);

  const { data, error } = await db
    .from("groups")
    .select("*")
    .in("id", groupIds)
    .order("updated_at", { ascending: false });

  if (error) throw new AppError(error.message, 500);

  const groups = (data as Group[]);

  // Fetch member counts
  const { data: memberCounts } = await db
    .from("group_members")
    .select("group_id")
    .in("group_id", groupIds);

  const countMap: Record<string, number> = {};
  for (const row of memberCounts ?? []) {
    countMap[row.group_id] = (countMap[row.group_id] ?? 0) + 1;
  }

  return groups.map((g) => ({ ...g, member_count: countMap[g.id] ?? 0 }));
}

export async function updateGroup(
  groupId: string,
  userId: string,
  dto: UpdateGroupDTO
): Promise<Group> {
  const group = await getGroupById(groupId);
  if (!group) throw new NotFoundError("Group");

  const member = await getMember(groupId, userId);
  if (!member || (member.role !== "owner" && member.role !== "moderator")) {
    throw new ForbiddenError("Only owners or moderators can update a group");
  }

  const db = getSupabaseAdmin();

  const { error } = await db
    .from("groups")
    .update({
      name: dto.name ?? group.name,
      description: dto.description ?? group.description,
      subject: dto.subject ?? group.subject,
      is_public: dto.is_public !== undefined ? dto.is_public : group.is_public,
      max_members: dto.max_members ?? group.max_members,
      updated_at: nowISO(),
    })
    .eq("id", groupId);

  if (error) throw new AppError(error.message, 500);

  const updated = await getGroupById(groupId);
  if (!updated) throw new AppError("Failed to update group", 500);
  return updated;
}

export async function deleteGroup(groupId: string, userId: string): Promise<void> {
  const group = await getGroupById(groupId);
  if (!group) throw new NotFoundError("Group");
  if (group.owner_id !== userId) throw new ForbiddenError("Only the owner can delete a group");

  const db = getSupabaseAdmin();

  const { error: membersError } = await db.from("group_members").delete().eq("group_id", groupId);
  if (membersError) throw new AppError(membersError.message, 500);

  const { error: postsError } = await db.from("group_posts").delete().eq("group_id", groupId);
  if (postsError) throw new AppError(postsError.message, 500);

  const { error } = await db.from("groups").delete().eq("id", groupId);
  if (error) throw new AppError(error.message, 500);
}

// ─── Membership ───────────────────────────────────────────────────────────────

export async function joinGroupByCode(userId: string, inviteCode: string): Promise<Group> {
  const db = getSupabaseAdmin();

  const { data: group, error } = await db
    .from("groups")
    .select("*")
    .eq("invite_code", inviteCode.toUpperCase())
    .single();

  if (error || !group) throw new NotFoundError("Group invite code");

  const existingMember = await getMember(group.id, userId);
  if (existingMember) throw new AppError("Already a member of this group", 409);

  // Get current member count
  const { count } = await db
    .from("group_members")
    .select("id", { count: "exact", head: true })
    .eq("group_id", group.id);

  const memberCount = count ?? 0;
  if (memberCount >= (group as Group).max_members) {
    throw new AppError("Group is full", 400);
  }

  await addMember(group.id, userId, "member");
  const updated = await getGroupById(group.id);
  return updated!;
}

export async function addMember(
  groupId: string,
  userId: string,
  role: "owner" | "moderator" | "member" = "member"
): Promise<void> {
  const db = getSupabaseAdmin();
  const id = generateId();

  const { error } = await db.from("group_members").insert({
    id,
    group_id: groupId,
    user_id: userId,
    role,
    joined_at: nowISO(),
  });

  if (error) throw new AppError(error.message, 500);
}

export async function removeMember(groupId: string, userId: string, requesterId: string): Promise<void> {
  const group = await getGroupById(groupId);
  if (!group) throw new NotFoundError("Group");

  const requester = await getMember(groupId, requesterId);
  const isOwner = requester?.role === "owner";
  const isSelf = userId === requesterId;

  if (!isOwner && !isSelf) {
    throw new ForbiddenError("Cannot remove this member");
  }
  if (group.owner_id === userId) {
    throw new AppError("The owner cannot leave the group. Transfer ownership first.", 400);
  }

  const db = getSupabaseAdmin();
  const { error } = await db
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);

  if (error) throw new AppError(error.message, 500);
}

export async function getMember(groupId: string, userId: string): Promise<GroupMember | null> {
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("group_members")
    .select("*")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;
  return data as GroupMember;
}

export async function listMembers(groupId: string): Promise<GroupMember[]> {
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("group_members")
    .select("*, users!inner(full_name, email, avatar_url)")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });

  if (error) throw new AppError(error.message, 500);

  return (data ?? []).map((row: any) => ({
    id: row.id,
    group_id: row.group_id,
    user_id: row.user_id,
    role: row.role,
    joined_at: row.joined_at,
    user_name: row.users?.full_name,
    user_email: row.users?.email,
    user_avatar: row.users?.avatar_url,
  })) as GroupMember[];
}

// ─── Posts ────────────────────────────────────────────────────────────────────

export async function createPost(
  groupId: string,
  userId: string,
  dto: CreateGroupPostDTO
): Promise<GroupPost> {
  const member = await getMember(groupId, userId);
  if (!member) throw new ForbiddenError("You are not a member of this group");

  const db = getSupabaseAdmin();
  const id = generateId();

  const { error } = await db.from("group_posts").insert({
    id,
    group_id: groupId,
    user_id: userId,
    content: dto.content,
    post_type: dto.post_type ?? "message",
    created_at: nowISO(),
  });

  if (error) throw new AppError(error.message, 500);

  const { data: post, error: fetchError } = await db
    .from("group_posts")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !post) throw new AppError("Failed to create post", 500);
  return post as GroupPost;
}

export async function listPosts(
  groupId: string,
  params: { page?: number; limit?: number } = {}
): Promise<GroupPost[]> {
  const db = getSupabaseAdmin();
  const limit = params.limit ?? 50;
  const offset = ((params.page ?? 1) - 1) * limit;

  const { data, error } = await db
    .from("group_posts")
    .select("*, users!inner(full_name, avatar_url)")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw new AppError(error.message, 500);

  return (data ?? []).map((row: any) => ({
    id: row.id,
    group_id: row.group_id,
    user_id: row.user_id,
    content: row.content,
    post_type: row.post_type,
    created_at: row.created_at,
    author_name: row.users?.full_name,
    author_avatar: row.users?.avatar_url,
  })) as GroupPost[];
}
