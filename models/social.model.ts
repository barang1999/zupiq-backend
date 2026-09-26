export interface UserFollow {
  follower_id: string;
  following_id: string;
  created_at: string;
}

export interface PublicProfile {
  id: string;
  full_name: string;
  avatar_url: string | null;
  grade: string | null;
  education_level: string | null;
  detected_level: string | null;
  level_confidence: number;
  bio: string | null;
  solution_count: number;
  question_count: number;
  resource_count: number;
  top_interests: Array<{
    topic: string;
    interest_score: number;
  }>;
  topic_interest_count: number;
  math_interests: Record<string, number>;
  learning_goals: string | null;
  is_following: boolean;
}
