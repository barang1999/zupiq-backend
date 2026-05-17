-- Reference corpus for textbook/source-grounded tutoring context.
-- Chunks keep flexible JSONB metadata while exposing common filters as columns.

create table if not exists reference_sources (
  id text primary key,
  title text not null,
  title_kh text,
  author text,
  language text not null default 'km',
  subject text not null,
  source_type text not null default 'book',
  grade_range text[] not null default '{}',
  topics text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  quality jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reference_chunks (
  id text primary key,
  source_id text not null references reference_sources(id) on delete cascade,
  language text not null default 'km',
  subject text not null,
  grade_range text[] not null default '{}',
  topic text not null,
  topic_kh text,
  page_start integer,
  page_end integer,
  chunk_type text not null default 'concept_explanation',
  text text not null,
  normalized_text text,
  formulas jsonb not null default '[]'::jsonb,
  keywords text[] not null default '{}',
  difficulty text,
  quality jsonb not null default '{}'::jsonb,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reference_chunks_subject_topic_idx
  on reference_chunks(subject, topic);

create index if not exists reference_chunks_keywords_idx
  on reference_chunks using gin(keywords);

create index if not exists reference_chunks_grade_range_idx
  on reference_chunks using gin(grade_range);

create index if not exists reference_chunks_content_idx
  on reference_chunks using gin(content);

-- Optional pgvector table. Enable the vector extension before using this in production.
-- create extension if not exists vector;
-- create table if not exists reference_chunk_embeddings (
--   chunk_id text primary key references reference_chunks(id) on delete cascade,
--   embedding vector(768) not null,
--   model text not null,
--   updated_at timestamptz not null default now()
-- );
