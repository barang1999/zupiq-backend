export type PostType = 'solution' | 'question' | 'resource' | 'photo' | 'document' | 'collection';
export type PostVisibility = 'public' | 'followers';

export interface Post {
  id: string;
  user_id: string;
  session_id: string | null;
  collection_id: string | null;
  type: PostType;
  visibility: PostVisibility;
  topic: string | null;
  grade: string | null;
  caption: string | null;
  image_url: string | null;
  image_ocr_text: string | null;
  file_url: string | null;
  file_name: string | null;
  verified: boolean;
  like_count: number;
  comment_count: number;
  save_count: number;
  created_at: string;
}

export interface PostAuthor {
  id: string;
  full_name: string;
  avatar_url: string | null;
  grade: string | null;
}

export interface PostFeedItem extends Post {
  author: PostAuthor;
  problem: string | null;
  breakdown_json: string | null;
  collection: {
    id: string;
    name: string;
    description: string | null;
    color: string;
    icon: string | null;
    item_count: number;
  } | null;
  is_liked: boolean;
  is_saved: boolean;
}

export interface CreatePostDTO {
  session_id?: string | null;
  collection_id?: string | null;
  type: PostType;
  visibility?: PostVisibility;
  topic?: string | null;
  grade?: string | null;
  caption?: string | null;
  image_url?: string | null;
  image_ocr_text?: string | null;
  file_url?: string | null;
  file_name?: string | null;
}
