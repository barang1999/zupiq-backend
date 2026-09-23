export interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  created_at: string;
}

export interface CommentWithAuthor extends Comment {
  author: {
    id: string;
    full_name: string;
    avatar_url: string | null;
    grade: string | null;
  };
}

export interface CreateCommentDTO {
  content: string;
  parent_id?: string | null;
}
