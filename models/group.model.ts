// ─── Enums ────────────────────────────────────────────────────────────────────

export type GroupMemberRole = "owner" | "moderator" | "member";

export type GroupPostType = "message" | "resource" | "question" | "announcement" | "flashcard_share";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface Group {
  id: string;
  name: string;
  description: string | null;
  subject: string | null;
  owner_id: string;
  invite_code: string;
  is_public: boolean;
  max_members: number;
  member_count?: number;
  created_at: string;
  updated_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  role: GroupMemberRole;
  joined_at: string;
  // Joined fields (from users table)
  user_name?: string;
  user_email?: string;
  user_avatar?: string;
}

export interface GroupPost {
  id: string;
  group_id: string;
  user_id: string;
  content: string;
  post_type: GroupPostType;
  created_at: string;
  // Joined fields
  author_name?: string;
  author_avatar?: string;
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateGroupDTO {
  name: string;
  description?: string;
  subject?: string;
  is_public?: boolean;
  max_members?: number;
}

export interface UpdateGroupDTO {
  name?: string;
  description?: string;
  subject?: string;
  is_public?: boolean;
  max_members?: number;
}

export interface CreateGroupPostDTO {
  content: string;
  post_type?: GroupPostType;
}
