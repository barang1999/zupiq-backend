export type ResourceFileType = 'pdf' | 'image' | 'link' | 'doc';

export interface Resource {
  id: string;
  user_id: string;
  post_id: string | null;
  title: string;
  description: string | null;
  file_url: string | null;
  file_type: ResourceFileType | null;
  tags: string[];
  topic: string | null;
  grade: string | null;
  download_count: number;
  created_at: string;
}

export interface ResourceWithAuthor extends Resource {
  author: {
    id: string;
    full_name: string;
    avatar_url: string | null;
    grade: string | null;
  };
  post_like_count: number;
  post_comment_count: number;
}

export interface CreateResourceDTO {
  title: string;
  description?: string | null;
  file_url?: string | null;
  file_type?: ResourceFileType | null;
  tags?: string[];
  topic?: string | null;
  grade?: string | null;
}
