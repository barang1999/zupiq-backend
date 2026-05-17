-- ─── 1. Add Sub-Subject (Topic) Columns to study_sessions ──────────────────────

ALTER TABLE study_sessions 
ADD COLUMN IF NOT EXISTS topic TEXT,
ADD COLUMN IF NOT EXISTS topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_study_sessions_topic_id ON study_sessions (topic_id);

-- ─── 2. Backfill existing sessions based on old raw subject strings ────────────

-- Backfill Math sessions
UPDATE study_sessions
SET 
  subject_id = '017d3f2f-f212-4cf1-b522-c176b7027acf',
  topic = 'algebra',
  topic_id = 'topic-math-algebra'
WHERE 
  (subject_id IS NULL OR subject_id = '017d3f2f-f212-4cf1-b522-c176b7027acf') AND (
    LOWER(subject) LIKE '%math%' OR 
    LOWER(subject) LIKE '%គណិត%' OR 
    LOWER(subject) LIKE '%ស្វ៊ីត%' OR 
    LOWER(subject) LIKE '%algebra%' OR 
    LOWER(subject) LIKE '%calculus%' OR 
    LOWER(subject) LIKE '%ពិជគណិត%'
  );

-- Backfill Physics sessions
UPDATE study_sessions
SET 
  subject_id = 'cc02b7ca-a34b-4010-b7e4-bffb9be2a3cb',
  topic = 'mechanics',
  topic_id = 'topic-physics-mechanics'
WHERE 
  (subject_id IS NULL OR subject_id = 'cc02b7ca-a34b-4010-b7e4-bffb9be2a3cb') AND (
    LOWER(subject) LIKE '%physic%' OR 
    LOWER(subject) LIKE '%រូបវិទ្យា%'
  );

-- Backfill Chemistry sessions
UPDATE study_sessions
SET 
  subject_id = '98dca07b-2f9f-4e8b-83a0-428863d1e527',
  topic = 'general-chemistry',
  topic_id = 'topic-chemistry-general-chemistry'
WHERE 
  (subject_id IS NULL OR subject_id = '98dca07b-2f9f-4e8b-83a0-428863d1e527') AND (
    LOWER(subject) LIKE '%chem%' OR 
    LOWER(subject) LIKE '%គីមី%'
  );

-- Default fallback subject_id for anything else
UPDATE study_sessions
SET subject_id = '017d3f2f-f212-4cf1-b522-c176b7027acf'
WHERE subject_id IS NULL;

-- ─── 3. Remove redundant raw subject text column ───────────────────────────────

ALTER TABLE study_sessions DROP COLUMN IF EXISTS subject;

-- ─── 4. Convert problem column from TEXT to JSONB ──────────────────────────────

ALTER TABLE study_sessions 
ALTER COLUMN problem TYPE JSONB 
USING jsonb_build_object('text', problem);

-- ─── 5. Reload Supabase Schema Cache ───────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
