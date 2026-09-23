-- ─────────────────────────────────────────────────────────────────────────────
-- Dev Schema — mirrors public exactly, isolated from production data.
-- Run this once in Supabase SQL Editor.
-- After running: Dashboard → Settings → API → Exposed schemas → add "dev"
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS dev;

-- ─── Users ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.users (
  id                       TEXT        PRIMARY KEY,
  email                    TEXT        UNIQUE NOT NULL,
  password_hash            TEXT        NOT NULL,
  full_name                TEXT        NOT NULL,
  education_level          TEXT        DEFAULT 'high_school',
  grade                    TEXT,
  language                 TEXT        DEFAULT 'en',
  preferences              JSONB       DEFAULT '{}',
  avatar_url               TEXT,
  current_streak           INT         NOT NULL DEFAULT 0,
  last_studied_date        DATE,
  unique_study_days_count  INT         NOT NULL DEFAULT 0,
  first_session_date       DATE,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_users_email ON dev.users (email);

-- ─── Subjects ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.subjects (
  id          TEXT        PRIMARY KEY,
  name        TEXT        NOT NULL,
  slug        TEXT        UNIQUE NOT NULL,
  description TEXT,
  icon        TEXT,
  color       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_subjects_slug ON dev.subjects (slug);

-- ─── Topics ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.topics (
  id          TEXT        PRIMARY KEY,
  subject_id  TEXT        NOT NULL REFERENCES dev.subjects (id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL,
  description TEXT,
  order_index INTEGER     DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_topics_subject_id ON dev.topics (subject_id);

-- ─── Lessons ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.lessons (
  id          TEXT        PRIMARY KEY,
  topic_id    TEXT        NOT NULL REFERENCES dev.topics (id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  content     TEXT,
  difficulty  TEXT        DEFAULT 'beginner',
  order_index INTEGER     DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_lessons_topic_id ON dev.lessons (topic_id);

-- ─── Study Sessions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.study_sessions (
  id                 TEXT        PRIMARY KEY,
  user_id            TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  title              TEXT        NOT NULL,
  subject            TEXT        NOT NULL DEFAULT 'General',
  subject_id         TEXT        REFERENCES dev.subjects (id) ON DELETE SET NULL,
  topic              TEXT,
  topic_id           TEXT        REFERENCES dev.topics (id) ON DELETE SET NULL,
  problem            TEXT        NOT NULL,
  node_count         INTEGER     NOT NULL DEFAULT 0,
  duration_seconds   INTEGER,
  breakdown_json     JSONB       NOT NULL DEFAULT '{}',
  image_url          TEXT,
  visual_table_json  JSONB,
  bookmarked         BOOLEAN     NOT NULL DEFAULT FALSE,
  prompt_tokens      INTEGER,
  completion_tokens  INTEGER,
  total_tokens       INTEGER,
  ai_cost_usd        NUMERIC(10,6),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_study_sessions_user_id    ON dev.study_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_dev_study_sessions_subject_id ON dev.study_sessions (subject_id);
CREATE INDEX IF NOT EXISTS idx_dev_study_sessions_topic_id   ON dev.study_sessions (topic_id);
CREATE INDEX IF NOT EXISTS idx_dev_study_sessions_created_at ON dev.study_sessions (created_at DESC);

-- ─── Session Members ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.session_members (
  id         TEXT        PRIMARY KEY,
  session_id TEXT        NOT NULL REFERENCES dev.study_sessions (id) ON DELETE CASCADE,
  user_id    TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  role       TEXT        NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dev_session_members_session_id ON dev.session_members (session_id);
CREATE INDEX IF NOT EXISTS idx_dev_session_members_user_id    ON dev.session_members (user_id);

-- ─── Flashcard Decks ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.flashcard_decks (
  id          TEXT        PRIMARY KEY,
  user_id     TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  lesson_id   TEXT        REFERENCES dev.lessons (id) ON DELETE SET NULL,
  title       TEXT        NOT NULL,
  description TEXT,
  subject_id  TEXT        REFERENCES dev.subjects (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_flashcard_decks_user_id    ON dev.flashcard_decks (user_id);
CREATE INDEX IF NOT EXISTS idx_dev_flashcard_decks_subject_id ON dev.flashcard_decks (subject_id);

-- ─── Flashcards ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.flashcards (
  id               TEXT        PRIMARY KEY,
  deck_id          TEXT        NOT NULL REFERENCES dev.flashcard_decks (id) ON DELETE CASCADE,
  front            TEXT        NOT NULL,
  back             TEXT        NOT NULL,
  hint             TEXT,
  difficulty       TEXT        DEFAULT 'medium',
  last_reviewed_at TIMESTAMPTZ,
  next_review_at   TIMESTAMPTZ,
  review_count     INTEGER     DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_flashcards_deck_id        ON dev.flashcards (deck_id);
CREATE INDEX IF NOT EXISTS idx_dev_flashcards_next_review_at ON dev.flashcards (next_review_at);

-- ─── Groups ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.groups (
  id          TEXT        PRIMARY KEY,
  name        TEXT        NOT NULL,
  description TEXT,
  subject     TEXT,
  owner_id    TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  invite_code TEXT        UNIQUE,
  is_public   BOOLEAN     DEFAULT TRUE,
  max_members INTEGER     DEFAULT 50,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_groups_owner_id    ON dev.groups (owner_id);
CREATE INDEX IF NOT EXISTS idx_dev_groups_invite_code ON dev.groups (invite_code);
CREATE INDEX IF NOT EXISTS idx_dev_groups_is_public   ON dev.groups (is_public);

-- ─── Group Members ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.group_members (
  id        TEXT        PRIMARY KEY,
  group_id  TEXT        NOT NULL REFERENCES dev.groups (id) ON DELETE CASCADE,
  user_id   TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  role      TEXT        DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dev_group_members_group_id ON dev.group_members (group_id);
CREATE INDEX IF NOT EXISTS idx_dev_group_members_user_id  ON dev.group_members (user_id);

-- ─── Group Posts ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.group_posts (
  id         TEXT        PRIMARY KEY,
  group_id   TEXT        NOT NULL REFERENCES dev.groups (id) ON DELETE CASCADE,
  user_id    TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  content    TEXT        NOT NULL,
  post_type  TEXT        DEFAULT 'message',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_group_posts_group_id ON dev.group_posts (group_id);
CREATE INDEX IF NOT EXISTS idx_dev_group_posts_user_id  ON dev.group_posts (user_id);

-- ─── Uploads ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.uploads (
  id            TEXT        PRIMARY KEY,
  user_id       TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  original_name TEXT        NOT NULL,
  stored_name   TEXT        NOT NULL,
  mime_type     TEXT        NOT NULL,
  size_bytes    INTEGER     NOT NULL,
  storage_url   TEXT,
  context       TEXT        DEFAULT 'general',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_uploads_user_id ON dev.uploads (user_id);

-- ─── Chat Messages ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.chat_messages (
  id         TEXT        PRIMARY KEY,
  user_id    TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  session_id TEXT        NOT NULL,
  step_id    TEXT,
  role       TEXT        NOT NULL,
  content    JSONB       NOT NULL,
  subject    TEXT,
  metadata   JSONB       DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_chat_messages_user_id    ON dev.chat_messages (user_id);
CREATE INDEX IF NOT EXISTS idx_dev_chat_messages_session_id ON dev.chat_messages (session_id);

-- ─── Subscriptions ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.subscriptions (
  id                       TEXT        PRIMARY KEY,
  user_id                  TEXT        NOT NULL UNIQUE REFERENCES dev.users (id) ON DELETE CASCADE,
  workspace_id             TEXT,
  plan_key                 TEXT        NOT NULL DEFAULT 'free',
  status                   TEXT        NOT NULL DEFAULT 'free',
  provider                 TEXT        NOT NULL DEFAULT 'none',
  billing_interval         TEXT,
  amount                   NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency                 TEXT        NOT NULL DEFAULT 'USD',
  cancel_at_period_end     BOOLEAN     NOT NULL DEFAULT FALSE,
  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  trial_start              TIMESTAMPTZ,
  trial_end                TIMESTAMPTZ,
  provider_customer_id     TEXT,
  provider_subscription_id TEXT,
  granted_by               TEXT        NOT NULL DEFAULT 'billing',
  metadata                 JSONB       NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_subscriptions_status     ON dev.subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_dev_subscriptions_plan_key   ON dev.subscriptions (plan_key);
CREATE INDEX IF NOT EXISTS idx_dev_subscriptions_period_end ON dev.subscriptions (current_period_end);

-- ─── Billing Provider Mappings ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.billing_provider_mappings (
  id               TEXT    PRIMARY KEY,
  plan_key         TEXT    NOT NULL,
  provider         TEXT    NOT NULL,
  environment      TEXT    NOT NULL DEFAULT 'production',
  product_id       TEXT,
  price_id_monthly TEXT,
  price_id_annual  TEXT,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (plan_key, provider, environment)
);

CREATE INDEX IF NOT EXISTS idx_dev_billing_provider_mappings_provider
  ON dev.billing_provider_mappings (provider, active);

-- ─── Feature Usage Daily ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.feature_usage_daily (
  id           TEXT    PRIMARY KEY,
  user_id      TEXT    NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  feature_key  TEXT    NOT NULL,
  usage_date   DATE    NOT NULL,
  used_count   INTEGER NOT NULL DEFAULT 0,
  metadata     JSONB   NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, feature_key, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_dev_feature_usage_daily_lookup
  ON dev.feature_usage_daily (user_id, feature_key, usage_date);

-- ─── Billing Events ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.billing_events (
  id                TEXT        PRIMARY KEY,
  user_id           TEXT        REFERENCES dev.users (id) ON DELETE SET NULL,
  provider          TEXT        NOT NULL,
  event_type        TEXT        NOT NULL,
  external_event_id TEXT,
  payload           JSONB       NOT NULL DEFAULT '{}',
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (provider, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_dev_billing_events_provider_created
  ON dev.billing_events (provider, created_at DESC);

-- ─── Quizzes ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.quizzes (
  id                 TEXT        PRIMARY KEY,
  user_id            TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  subject_id         TEXT        REFERENCES dev.subjects (id) ON DELETE SET NULL,
  topic_id           TEXT        REFERENCES dev.topics (id) ON DELETE SET NULL,
  title              TEXT        NOT NULL,
  description        TEXT,
  level              TEXT        NOT NULL DEFAULT 'medium',
  specific_area      TEXT,
  quiz_mode          TEXT        NOT NULL DEFAULT 'mixed',
  question_count     INTEGER     NOT NULL DEFAULT 0,
  total_marks        NUMERIC(8,2) NOT NULL DEFAULT 0,
  status             TEXT        NOT NULL DEFAULT 'draft',
  generation_prompt  JSONB       NOT NULL DEFAULT '{}',
  generation_context JSONB       NOT NULL DEFAULT '{}',
  ai_model           TEXT,
  ai_provider        TEXT,
  ai_version         TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_quizzes_user_id    ON dev.quizzes (user_id);
CREATE INDEX IF NOT EXISTS idx_dev_quizzes_subject_id ON dev.quizzes (subject_id);
CREATE INDEX IF NOT EXISTS idx_dev_quizzes_topic_id   ON dev.quizzes (topic_id);
CREATE INDEX IF NOT EXISTS idx_dev_quizzes_created_at ON dev.quizzes (created_at DESC);

-- ─── Quiz Questions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.quiz_questions (
  id              TEXT        PRIMARY KEY,
  quiz_id         TEXT        NOT NULL REFERENCES dev.quizzes (id) ON DELETE CASCADE,
  question_order  INTEGER     NOT NULL,
  question_type   TEXT        NOT NULL,
  question_text   TEXT        NOT NULL,
  instructions    TEXT,
  options         JSONB       NOT NULL DEFAULT '[]',
  expected_answer JSONB       NOT NULL DEFAULT '{}',
  grading_rubric  JSONB       NOT NULL DEFAULT '{}',
  explanation     TEXT,
  marks           NUMERIC(8,2) NOT NULL DEFAULT 1,
  difficulty      TEXT        NOT NULL DEFAULT 'medium',
  metadata        JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (quiz_id, question_order)
);

CREATE INDEX IF NOT EXISTS idx_dev_quiz_questions_quiz_id ON dev.quiz_questions (quiz_id);
CREATE INDEX IF NOT EXISTS idx_dev_quiz_questions_type    ON dev.quiz_questions (question_type);

-- ─── Quiz Attempts ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.quiz_attempts (
  id                TEXT        PRIMARY KEY,
  quiz_id           TEXT        NOT NULL REFERENCES dev.quizzes (id) ON DELETE CASCADE,
  user_id           TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  status            TEXT        NOT NULL DEFAULT 'in_progress',
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  submitted_at      TIMESTAMPTZ,
  graded_at         TIMESTAMPTZ,
  score             NUMERIC(8,2) NOT NULL DEFAULT 0,
  total_marks       NUMERIC(8,2) NOT NULL DEFAULT 0,
  percentage        NUMERIC(5,2) NOT NULL DEFAULT 0,
  feedback_summary  TEXT,
  strengths         JSONB       NOT NULL DEFAULT '[]',
  weaknesses        JSONB       NOT NULL DEFAULT '[]',
  improvement_areas JSONB       NOT NULL DEFAULT '[]',
  ai_evaluation     JSONB       NOT NULL DEFAULT '{}',
  ai_model          TEXT,
  ai_provider       TEXT,
  ai_version        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_quiz_attempts_user_id    ON dev.quiz_attempts (user_id);
CREATE INDEX IF NOT EXISTS idx_dev_quiz_attempts_quiz_id    ON dev.quiz_attempts (quiz_id);
CREATE INDEX IF NOT EXISTS idx_dev_quiz_attempts_status     ON dev.quiz_attempts (status);
CREATE INDEX IF NOT EXISTS idx_dev_quiz_attempts_created_at ON dev.quiz_attempts (created_at DESC);

-- ─── Quiz Answers ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.quiz_answers (
  id                     TEXT        PRIMARY KEY,
  attempt_id             TEXT        NOT NULL REFERENCES dev.quiz_attempts (id) ON DELETE CASCADE,
  question_id            TEXT        NOT NULL REFERENCES dev.quiz_questions (id) ON DELETE CASCADE,
  answer_text            TEXT,
  answer_json            JSONB       NOT NULL DEFAULT '{}',
  answer_upload_id       TEXT        REFERENCES dev.uploads (id) ON DELETE SET NULL,
  extracted_text         TEXT,
  extraction_confidence  NUMERIC(5,2),
  grading_confidence     NUMERIC(5,2),
  is_correct             BOOLEAN,
  awarded_marks          NUMERIC(8,2) NOT NULL DEFAULT 0,
  ai_feedback            TEXT,
  correction             TEXT,
  review_required        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_dev_quiz_answers_attempt_id  ON dev.quiz_answers (attempt_id);
CREATE INDEX IF NOT EXISTS idx_dev_quiz_answers_question_id ON dev.quiz_answers (question_id);
CREATE INDEX IF NOT EXISTS idx_dev_quiz_answers_upload_id   ON dev.quiz_answers (answer_upload_id);

-- ─── User Topic Mastery ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.user_topic_mastery (
  id             TEXT        PRIMARY KEY,
  user_id        TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  subject_id     TEXT        REFERENCES dev.subjects (id) ON DELETE CASCADE,
  topic_id       TEXT        REFERENCES dev.topics (id) ON DELETE CASCADE,
  level          TEXT,
  mastery_score  NUMERIC(5,2) NOT NULL DEFAULT 0,
  quizzes_taken  INTEGER     NOT NULL DEFAULT 0,
  average_score  NUMERIC(5,2) NOT NULL DEFAULT 0,
  last_quiz_at   TIMESTAMPTZ,
  metadata       JSONB       NOT NULL DEFAULT '{}',
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, subject_id, topic_id, level)
);

CREATE INDEX IF NOT EXISTS idx_dev_user_topic_mastery_user_id    ON dev.user_topic_mastery (user_id);
CREATE INDEX IF NOT EXISTS idx_dev_user_topic_mastery_subject_id ON dev.user_topic_mastery (subject_id);
CREATE INDEX IF NOT EXISTS idx_dev_user_topic_mastery_topic_id   ON dev.user_topic_mastery (topic_id);

-- ─── Quiz Evaluation Events ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.quiz_evaluation_events (
  id         TEXT        PRIMARY KEY,
  attempt_id TEXT        NOT NULL REFERENCES dev.quiz_attempts (id) ON DELETE CASCADE,
  event_type TEXT        NOT NULL,
  payload    JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_quiz_evaluation_events_attempt_id
  ON dev.quiz_evaluation_events (attempt_id);

-- ─── Password Reset Tokens ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.password_reset_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  token      TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dev_prt_token   ON dev.password_reset_tokens (token);
CREATE INDEX IF NOT EXISTS idx_dev_prt_user_id ON dev.password_reset_tokens (user_id);

-- ─── Breakdown Feedback ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.breakdown_feedback (
  session_id TEXT        NOT NULL REFERENCES dev.study_sessions (id) ON DELETE CASCADE,
  user_id    TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  signal     TEXT        NOT NULL CHECK (signal IN ('positive', 'negative')),
  reasons    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dev_breakdown_feedback_user_id    ON dev.breakdown_feedback (user_id);
CREATE INDEX IF NOT EXISTS idx_dev_breakdown_feedback_signal     ON dev.breakdown_feedback (signal);
CREATE INDEX IF NOT EXISTS idx_dev_breakdown_feedback_updated_at ON dev.breakdown_feedback (updated_at DESC);

-- ─── Problem Embeddings ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.problem_embeddings (
  id             TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  session_id     TEXT        NOT NULL UNIQUE REFERENCES dev.study_sessions (id) ON DELETE CASCADE,
  user_id        TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  subject        TEXT,
  topic          TEXT,
  problem_text   TEXT        NOT NULL,
  language       TEXT        NOT NULL DEFAULT 'en',
  embedding      vector(768),
  final_answer   TEXT,
  solution_text  TEXT,
  breakdown_json JSONB,
  feedback_count INTEGER     NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_problem_embeddings_subject  ON dev.problem_embeddings (subject);
CREATE INDEX IF NOT EXISTS idx_dev_problem_embeddings_language ON dev.problem_embeddings (language);
CREATE INDEX IF NOT EXISTS idx_dev_problem_embeddings_embedding
  ON dev.problem_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─── Email Templates ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.email_templates (
  id         TEXT        PRIMARY KEY,
  name       TEXT        NOT NULL,
  subject    TEXT        NOT NULL,
  body       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_email_templates_created ON dev.email_templates (created_at DESC);

-- ─── Posts ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.posts (
  id            TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id       TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  session_id    TEXT        REFERENCES dev.study_sessions (id) ON DELETE SET NULL,
  type          TEXT        NOT NULL CHECK (type IN ('solution', 'question', 'resource', 'photo')),
  visibility    TEXT        NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'followers')),
  topic         TEXT,
  grade         TEXT,
  caption       TEXT,
  image_url     TEXT,
  verified      BOOLEAN     NOT NULL DEFAULT FALSE,
  like_count    INTEGER     NOT NULL DEFAULT 0,
  comment_count INTEGER     NOT NULL DEFAULT 0,
  save_count    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_posts_user_id    ON dev.posts (user_id);
CREATE INDEX IF NOT EXISTS idx_dev_posts_topic      ON dev.posts (topic);
CREATE INDEX IF NOT EXISTS idx_dev_posts_visibility ON dev.posts (visibility);
CREATE INDEX IF NOT EXISTS idx_dev_posts_created_at ON dev.posts (created_at DESC);

-- ─── Post Likes ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.post_likes (
  post_id    TEXT        NOT NULL REFERENCES dev.posts (id) ON DELETE CASCADE,
  user_id    TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dev_post_likes_user_id ON dev.post_likes (user_id);

-- ─── Post Saves ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.post_saves (
  post_id    TEXT        NOT NULL REFERENCES dev.posts (id) ON DELETE CASCADE,
  user_id    TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dev_post_saves_user_id ON dev.post_saves (user_id);

-- ─── Post Comments ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.post_comments (
  id         TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  post_id    TEXT        NOT NULL REFERENCES dev.posts (id) ON DELETE CASCADE,
  user_id    TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  parent_id  TEXT        REFERENCES dev.post_comments (id) ON DELETE CASCADE,
  content    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_post_comments_post_id ON dev.post_comments (post_id);
CREATE INDEX IF NOT EXISTS idx_dev_post_comments_user_id ON dev.post_comments (user_id);

-- ─── User Follows ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.user_follows (
  follower_id  TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  following_id TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE INDEX IF NOT EXISTS idx_dev_user_follows_follower_id  ON dev.user_follows (follower_id);
CREATE INDEX IF NOT EXISTS idx_dev_user_follows_following_id ON dev.user_follows (following_id);

-- ─── Resources ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dev.resources (
  id             TEXT        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id        TEXT        NOT NULL REFERENCES dev.users (id) ON DELETE CASCADE,
  post_id        TEXT        REFERENCES dev.posts (id) ON DELETE CASCADE,
  title          TEXT        NOT NULL,
  description    TEXT,
  file_url       TEXT,
  file_type      TEXT        CHECK (file_type IN ('pdf', 'image', 'link', 'doc')),
  tags           TEXT[]      NOT NULL DEFAULT '{}',
  topic          TEXT,
  grade          TEXT,
  download_count INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_resources_user_id    ON dev.resources (user_id);
CREATE INDEX IF NOT EXISTS idx_dev_resources_topic      ON dev.resources (topic);
CREATE INDEX IF NOT EXISTS idx_dev_resources_created_at ON dev.resources (created_at DESC);

-- ─── Post Count Triggers ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION dev.increment_post_like_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE dev.posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION dev.decrement_post_like_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE dev.posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_dev_post_likes_insert
AFTER INSERT ON dev.post_likes
FOR EACH ROW EXECUTE FUNCTION dev.increment_post_like_count();

CREATE OR REPLACE TRIGGER trg_dev_post_likes_delete
AFTER DELETE ON dev.post_likes
FOR EACH ROW EXECUTE FUNCTION dev.decrement_post_like_count();

CREATE OR REPLACE FUNCTION dev.increment_post_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE dev.posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION dev.decrement_post_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE dev.posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_dev_post_comments_insert
AFTER INSERT ON dev.post_comments
FOR EACH ROW EXECUTE FUNCTION dev.increment_post_comment_count();

CREATE OR REPLACE TRIGGER trg_dev_post_comments_delete
AFTER DELETE ON dev.post_comments
FOR EACH ROW EXECUTE FUNCTION dev.decrement_post_comment_count();

CREATE OR REPLACE FUNCTION dev.increment_post_save_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE dev.posts SET save_count = save_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION dev.decrement_post_save_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE dev.posts SET save_count = GREATEST(save_count - 1, 0) WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_dev_post_saves_insert
AFTER INSERT ON dev.post_saves
FOR EACH ROW EXECUTE FUNCTION dev.increment_post_save_count();

CREATE OR REPLACE TRIGGER trg_dev_post_saves_delete
AFTER DELETE ON dev.post_saves
FOR EACH ROW EXECUTE FUNCTION dev.decrement_post_save_count();
