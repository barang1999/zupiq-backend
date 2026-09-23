# Supabase Schema Setup — Dev vs Production

> Last updated: 2026-09-21

---

## Overview

One Supabase project, two isolated schemas:

| Schema | Purpose | Used by |
|---|---|---|
| `public` | Production data — real users | `.env.production` |
| `dev` | Development/testing data | `.env.development` |

Storage buckets (`user-uploads`, `avatars`, `discover_post`) are **global** — not schema-scoped. They're shared across both environments.

---

## How It Works

The Supabase JS client accepts a `db.schema` option that routes all PostgREST queries to a specific schema. The backend reads the target schema from the `SUPABASE_SCHEMA` environment variable.

```
NODE_ENV=development  →  SUPABASE_SCHEMA=dev    →  queries hit dev.*
NODE_ENV=production   →  SUPABASE_SCHEMA=public →  queries hit public.*
```

---

## Environment Variables

**`.env.development`**
```env
SUPABASE_URL=https://dplguqactewoycxbbsce.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_SCHEMA=dev
```

**`.env.production`**
```env
SUPABASE_URL=https://dplguqactewoycxbbsce.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_SCHEMA=public
```

If `SUPABASE_SCHEMA` is not set, it defaults to `public`.

---

## Code — How the Schema is Applied

**`config/env.ts`**
```ts
SUPABASE_SCHEMA: optionalEnv("SUPABASE_SCHEMA", "public"),
```

**`config/supabase.ts`**
```ts
const supabaseOptions = {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: supabaseFetch },
  db: { schema: env.SUPABASE_SCHEMA },
};
```

Both `getSupabaseAdmin()` and `getSupabaseClient()` use these options, so all queries are automatically scoped to the correct schema.

---

## One-Time Supabase Dashboard Setup (already done)

### 1. Expose the `dev` schema via Data API
Dashboard → **Integrations** → **Data API** → **Settings** tab → **Exposed schemas** → select `dev` → Save.

`dev`, `graphql_public`, `production`, and `public` should all be checked.

### 2. Run the dev schema migration
Dashboard → **SQL Editor** → paste `supabase/migrations/20260921000009_create_dev_schema.sql` → Run.

This creates all tables, indexes, and triggers under `dev.*`.

### 3. Grant permissions to Postgres roles
By default, new schemas are not accessible by `anon`, `authenticated`, or `service_role`. Run `supabase/migrations/20260921000010_dev_schema_permissions.sql` in the SQL Editor:

```sql
GRANT USAGE ON SCHEMA dev TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES    IN SCHEMA dev TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA dev TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES  IN SCHEMA dev TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA dev
  GRANT ALL ON TABLES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA dev
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA dev
  GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
```

The `ALTER DEFAULT PRIVILEGES` lines ensure any future tables added to `dev` are automatically accessible without needing to re-run grants.

---

## Adding New Tables

When you add a new table to production (via a migration), you must also add it to the `dev` schema. The pattern:

**Production migration** (`supabase/migrations/YYYYMMDDHHMMSS_create_foo.sql`):
```sql
CREATE TABLE IF NOT EXISTS foo ( ... );
```

**Dev mirror** — append to `20260921000009_create_dev_schema.sql` or create a new paired migration:
```sql
CREATE TABLE IF NOT EXISTS dev.foo ( ... );
-- Remember: all REFERENCES must point to dev.* tables
```

---

## Triggers & Functions

Triggers in the `dev` schema are namespaced to avoid conflicts with `public`:

- Functions: `dev.increment_post_like_count()`, `dev.decrement_post_like_count()`, etc.
- Triggers: `trg_dev_post_likes_insert`, `trg_dev_post_likes_delete`, etc.

When adding new triggers, always prefix with `dev.` for functions and `trg_dev_` for trigger names.

---

## Table List

All tables below exist in both `public` and `dev` schemas.

| Table | Description |
|---|---|
| `users` | App users (email/password + Google/Apple auth) |
| `subjects` | Subject taxonomy (Math, Physics, etc.) |
| `topics` | Topics within subjects |
| `lessons` | Lesson content per topic |
| `study_sessions` | AI-generated problem solutions |
| `session_members` | Collaboration members on a session |
| `chat_messages` | AI chat turns per session |
| `uploads` | File upload metadata |
| `flashcard_decks` | User flashcard collections |
| `flashcards` | Individual flashcard Q&A |
| `groups` | Study groups |
| `group_members` | Group membership |
| `group_posts` | Posts within a group |
| `subscriptions` | Normalized billing subscriptions |
| `billing_provider_mappings` | Stripe/RevenueCat plan mappings |
| `billing_events` | Raw billing webhook audit log |
| `feature_usage_daily` | Per-user daily feature usage counters |
| `quizzes` | AI-generated quizzes |
| `quiz_questions` | Questions within a quiz |
| `quiz_attempts` | User quiz attempt records |
| `quiz_answers` | Per-question answers in an attempt |
| `user_topic_mastery` | Mastery scores per user/topic |
| `quiz_evaluation_events` | AI evaluation audit log |
| `password_reset_tokens` | Forgot-password token store |
| `breakdown_feedback` | Thumbs up/down on AI breakdowns |
| `problem_embeddings` | Vector embeddings for semantic search |
| `email_templates` | Admin-managed transactional email templates |
| `posts` | Social feed posts (solution/question/photo) |
| `post_likes` | Like records per post/user |
| `post_saves` | Save records per post/user |
| `post_comments` | Comments on posts |
| `user_follows` | Follow graph (follower → following) |
| `resources` | Shared study resources (PDF/link/doc) |

---

## Troubleshooting

**Queries returning empty results after switching schema**
- Make sure the migration (`20260921000009_create_dev_schema.sql`) was run in the SQL Editor.
- Confirm `SUPABASE_SCHEMA=dev` is in `.env.development`.
- Restart the backend (`npm run dev`).

**`permission denied for schema dev`**
- The Postgres roles haven't been granted access yet. Run `20260921000010_dev_schema_permissions.sql` in the SQL Editor.

**`relation "dev.foo" does not exist`**
- The table hasn't been created in `dev` yet. Add it to the dev migration and re-run.

**`schema "dev" does not exist` error from PostgREST**
- The migration hasn't been run yet, or the `dev` schema is not in the exposed schemas list.

**Storage uploads going to wrong bucket**
- Storage is not schema-scoped. Bucket names are the same for dev and prod. If you want isolated storage, create separate buckets (e.g. `discover_post_dev`) and gate on `NODE_ENV`.
