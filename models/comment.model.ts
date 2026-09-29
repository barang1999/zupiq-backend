export interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  parent_id: string | null;
  image_url: string | null;
  content: string;
  created_at: string;
}

export interface CommentWithAuthor extends Comment {
  like_count: number;
  reply_count: number;
  is_liked: boolean;
  author: {
    id: string;
    full_name: string;
    avatar_url: string | null;
    grade: string | null;
    is_verified: boolean;
  };
}

export interface CreateCommentDTO {
  content: string;
  parent_id?: string | null;
  image_url?: string | null;
}
