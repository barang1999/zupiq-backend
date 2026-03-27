-- ─────────────────────────────────────────────────────────────────────────────
-- Zupiq AI — Supabase Postgres Schema
-- Run this ONCE in your Supabase SQL Editor:
--   Dashboard → SQL Editor → New Query → paste → Run
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Users ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  education_level TEXT DEFAULT 'high_school',
  grade TEXT,
  language TEXT DEFAULT 'en',
  preferences JSONB DEFAULT '{}',
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ─── Subjects ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  icon TEXT,
  color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subjects_slug ON subjects (slug);

-- ─── Topics ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_topics_subject_id ON topics (subject_id);

-- ─── Lessons ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  difficulty TEXT DEFAULT 'beginner',
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lessons_topic_id ON lessons (topic_id);

-- ─── Flashcard Decks ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS flashcard_decks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lesson_id TEXT REFERENCES lessons (id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  subject TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flashcard_decks_user_id ON flashcard_decks (user_id);

-- ─── Flashcards ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS flashcards (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL REFERENCES flashcard_decks (id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  hint TEXT,
  difficulty TEXT DEFAULT 'medium',
  last_reviewed_at TIMESTAMPTZ,
  next_review_at TIMESTAMPTZ,
  review_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flashcards_deck_id ON flashcards (deck_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_next_review_at ON flashcards (next_review_at);

-- ─── Groups ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  subject TEXT,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  invite_code TEXT UNIQUE,
  is_public BOOLEAN DEFAULT TRUE,
  max_members INTEGER DEFAULT 50,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_groups_owner_id ON groups (owner_id);
CREATE INDEX IF NOT EXISTS idx_groups_invite_code ON groups (invite_code);
CREATE INDEX IF NOT EXISTS idx_groups_is_public ON groups (is_public);

-- ─── Group Members ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members (group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON group_members (user_id);

-- ─── Group Posts ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS group_posts (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  post_type TEXT DEFAULT 'message',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_posts_group_id ON group_posts (group_id);
CREATE INDEX IF NOT EXISTS idx_group_posts_user_id ON group_posts (user_id);

-- ─── Uploads ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_url TEXT,
  context TEXT DEFAULT 'general',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uploads_user_id ON uploads (user_id);

-- ─── AI Chat Messages ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  subject TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages (user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages (session_id);

-- ─── Study Sessions ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS study_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT 'General',
  problem TEXT NOT NULL,
  node_count INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER,
  breakdown_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_study_sessions_user_id ON study_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_study_sessions_created_at ON study_sessions (created_at DESC);

-- ─── Billing: Normalized Subscriptions ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  workspace_id TEXT,
  plan_key TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'free',
  provider TEXT NOT NULL DEFAULT 'none',
  billing_interval TEXT,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  trial_start TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  granted_by TEXT NOT NULL DEFAULT 'billing',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_key ON subscriptions (plan_key);
CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end ON subscriptions (current_period_end);

-- ─── Billing: Provider Mapping ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_provider_mappings (
  id TEXT PRIMARY KEY,
  plan_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'production',
  product_id TEXT,
  price_id_monthly TEXT,
  price_id_annual TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (plan_key, provider, environment)
);

CREATE INDEX IF NOT EXISTS idx_billing_provider_mappings_provider
  ON billing_provider_mappings (provider, active);

-- ─── Billing: Daily Feature Usage ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feature_usage_daily (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  usage_date DATE NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, feature_key, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_feature_usage_daily_lookup
  ON feature_usage_daily (user_id, feature_key, usage_date);

-- ─── Billing: Raw Event Audit ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  external_event_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (provider, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_events_provider_created
  ON billing_events (provider, created_at DESC);
