import { getSupabaseAdmin } from "../config/supabase.js";
import { generateId, nowISO, addDays } from "../utils/helpers.js";
import {
  AppError,
  ForbiddenError,
  NotFoundError,
} from "../api/middlewares/error.middleware.js";
import type { MemberRole, SessionInvitation, SessionMemberWithUser } from "../models/collaboration.model.js";

// ─── Access helpers ───────────────────────────────────────────────────────────

export async function canUserAccessSession(sessionId: string, userId: string): Promise<boolean> {
  const db = getSupabaseAdmin();

  const { data: session } = await db
    .from("study_sessions")
    .select("user_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) return false;
  if (session.user_id === userId) return true;

  const { data: member } = await db
    .from("session_members")
    .select("id")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  return !!member;
}

export async function canUserEditSession(sessionId: string, userId: string): Promise<boolean> {
  const db = getSupabaseAdmin();

  const { data: session } = await db
    .from("study_sessions")
    .select("user_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) return false;
  if (session.user_id === userId) return true;

  const { data: member } = await db
    .from("session_members")
    .select("role")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  return member?.role === "editor";
}

// ─── Invitation management ────────────────────────────────────────────────────

export async function createInvitation(
  sessionId: string,
  invitedByUserId: string,
  role: "editor" | "viewer" = "editor"
): Promise<SessionInvitation> {
  const db = getSupabaseAdmin();

  const { data: session } = await db
    .from("study_sessions")
    .select("user_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) throw new NotFoundError("Session");

  const canInvite =
    session.user_id === invitedByUserId ||
    (await isEditorMember(sessionId, invitedByUserId));

  if (!canInvite) {
    throw new ForbiddenError("Only session owners and editors can invite others");
  }

  const invitation: SessionInvitation = {
    id: generateId(),
    session_id: sessionId,
    invited_by: invitedByUserId,
    invite_token: generateId(),
    invited_email: null,
    role,
    expires_at: addDays(new Date(), 7).toISOString(),
    accepted_at: null,
    created_at: nowISO(),
  };

  const { error } = await db.from("session_invitations").insert(invitation);
  if (error) throw new AppError(error.message, 500);

  return invitation;
}

export async function getInvitationPreview(
  token: string
): Promise<(SessionInvitation & { session_title: string; inviter_name: string }) | null> {
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("session_invitations")
    .select("*")
    .eq("invite_token", token)
    .maybeSingle();

  if (error || !data) return null;
  if (new Date(data.expires_at) < new Date()) return null;

  const [sessionRes, userRes] = await Promise.all([
    db.from("study_sessions").select("title").eq("id", data.session_id).maybeSingle(),
    db.from("users").select("full_name").eq("id", data.invited_by).maybeSingle(),
  ]);

  return {
    ...(data as SessionInvitation),
    session_title: sessionRes.data?.title ?? "Untitled Session",
    inviter_name: userRes.data?.full_name ?? "Someone",
  };
}

export async function acceptInvitation(
  token: string,
  userId: string
): Promise<{ sessionId: string; role: string; invitedBy: string | null }> {
  const db = getSupabaseAdmin();

  const { data: invitation, error: fetchError } = await db
    .from("session_invitations")
    .select("*")
    .eq("invite_token", token)
    .maybeSingle();

  if (fetchError || !invitation) throw new NotFoundError("Invitation");
  if (invitation.accepted_at) throw new AppError("Invitation already used", 400);
  if (new Date(invitation.expires_at) < new Date()) {
    throw new AppError("Invitation has expired", 400);
  }

  const { data: session } = await db
    .from("study_sessions")
    .select("user_id")
    .eq("id", invitation.session_id)
    .maybeSingle();

  // If the user is already the owner just mark the invite accepted
  if (session?.user_id === userId) {
    await db
      .from("session_invitations")
      .update({ accepted_at: nowISO() })
      .eq("id", invitation.id);
    return { sessionId: invitation.session_id, role: invitation.role, invitedBy: invitation.invited_by ?? null };
  }

  // Upsert membership (gracefully handles duplicate joins)
  const { error: memberError } = await db
    .from("session_members")
    .upsert(
      {
        id: generateId(),
        session_id: invitation.session_id,
        user_id: userId,
        role: invitation.role,
        invited_by: invitation.invited_by,
        joined_at: nowISO(),
      },
      { onConflict: "session_id,user_id" }
    );

  if (memberError) throw new AppError(memberError.message, 500);

  await db
    .from("session_invitations")
    .update({ accepted_at: nowISO() })
    .eq("id", invitation.id);

  return { sessionId: invitation.session_id, role: invitation.role, invitedBy: invitation.invited_by ?? null };
}

// ─── Member management ────────────────────────────────────────────────────────

export async function getSessionMembers(sessionId: string): Promise<SessionMemberWithUser[]> {
  const db = getSupabaseAdmin();

  const { data: session, error: sessionError } = await db
    .from("study_sessions")
    .select("user_id, created_at")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError || !session) return [];

  // Fetch non-owner members — join via separate query since Supabase JS may
  // not support FK references depending on RLS config.
  const { data: memberRows, error: membersError } = await db
    .from("session_members")
    .select("id, user_id, role, invited_by, joined_at")
    .eq("session_id", sessionId);

  if (membersError) throw new AppError(membersError.message, 500);

  const allUserIds = [
    session.user_id,
    ...(memberRows ?? []).map((m: Record<string, unknown>) => m.user_id as string),
  ];

  const { data: users } = await db
    .from("users")
    .select("id, full_name, email, avatar_url")
    .in("id", allUserIds);

  const userMap = new Map(
    (users ?? []).map((u: Record<string, unknown>) => [
      u.id as string,
      {
        full_name: String(u.full_name ?? ""),
        email: String(u.email ?? ""),
        avatar_url: (u.avatar_url as string | null) ?? null,
      },
    ])
  );

  const ownerInfo = userMap.get(session.user_id) ?? { full_name: "", email: "", avatar_url: null };
  const ownerEntry: SessionMemberWithUser = {
    id: `owner_${session.user_id}`,
    session_id: sessionId,
    user_id: session.user_id,
    role: "owner",
    invited_by: null,
    joined_at: String(session.created_at),
    ...ownerInfo,
  };

  const memberEntries: SessionMemberWithUser[] = (memberRows ?? []).map(
    (m: Record<string, unknown>) => {
      const info = userMap.get(m.user_id as string) ?? { full_name: "", email: "", avatar_url: null };
      return {
        id: String(m.id),
        session_id: sessionId,
        user_id: String(m.user_id),
        role: String(m.role) as MemberRole,
        invited_by: (m.invited_by as string | null) ?? null,
        joined_at: String(m.joined_at),
        ...info,
      };
    }
  );

  return [ownerEntry, ...memberEntries];
}

export async function removeSessionMember(
  sessionId: string,
  targetUserId: string,
  requestingUserId: string
): Promise<void> {
  const db = getSupabaseAdmin();

  const { data: session } = await db
    .from("study_sessions")
    .select("user_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) throw new NotFoundError("Session");

  const isOwner = session.user_id === requestingUserId;
  const isSelf = targetUserId === requestingUserId;

  if (!isOwner && !isSelf) {
    throw new ForbiddenError("Only the session owner can remove other members");
  }

  if (targetUserId === session.user_id) {
    throw new AppError("Cannot remove the session owner", 400);
  }

  const { error } = await db
    .from("session_members")
    .delete()
    .eq("session_id", sessionId)
    .eq("user_id", targetUserId);

  if (error) throw new AppError(error.message, 500);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function isEditorMember(sessionId: string, userId: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from("session_members")
    .select("role")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.role === "editor";
}
