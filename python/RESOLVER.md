# Zupiq Semantic Resolver

A Python sidecar service that learns from positively-rated study sessions and serves instant cached answers for structurally similar problems — eliminating AI latency and token cost for common patterns.

---

## How It Works

### 3-Tier Lookup

Every problem submitted by a user passes through the resolver before reaching the AI:

```
User submits problem
        │
        ▼
  /resolve (Python)
        │
   embed + search
        │
   ┌────┴────────────────┐
   │  similarity score   │
   └────┬────────────────┘
        │
   ≥ 0.92 ──► INSTANT   Return cached breakdown directly. No AI call.
   ≥ 0.80 ──► HINT      Inject cached solution as few-shot context. Faster AI.
   < 0.80 ──► NONE      Full AI call as normal.
```

### Learning from Feedback

The cache only grows from **positively-rated** sessions. When a user gives thumbs up:

```
Thumbs up
    │
    ▼
Node backend (sessions.routes.ts)
    │  fire-and-forget
    ▼
POST /index (Python)
    │
    ├─ embed(problem_text)  →  768-dim vector
    └─ upsert into problem_embeddings table
```

Bad answers never pollute the cache. The `feedback_count` column increments each time the same session gets upvoted again, reinforcing high-quality solutions.

---

## Embedding Strategy

### Structure over Values

Numbers are replaced with a placeholder `N` before embedding so the model captures **problem structure**, not specific values.

```
"Solve 2x² + 5x + 3 = 0"  →  "Solve Nx² + Nx + N = N"
"Solve 4x² + 7x + 2 = 0"  →  "Solve Nx² + Nx + N = N"
```

Both problems produce near-identical 768-dim vectors and hit the same cache entry.

### LaTeX Normalization

LaTeX formatting is stripped before embedding so math semantics dominate, not formatting tokens:

```
\frac{1}{2}mv^2  →  N m v
```

### Pipeline (`embedder.py`)

```
raw problem text
      │
      ▼
strip LaTeX delimiters ($$ \[ \] etc.)
      │
      ▼
strip LaTeX commands (\frac \int \sqrt etc.)
      │
      ▼
replace numbers with N
      │
      ▼
collapse whitespace
      │
      ▼
Gemini gemini-embedding-001  →  768-dim float vector
```

---

## Language Isolation

Solutions are stored and retrieved **per language**. A Khmer solution is never served to a Korean user even if the problem structure is identical.

```
Index:    { problem_text, language: "km", solution_text: "ដំណោះស្រាយ..." }
Resolve:  { problem_text, language: "ko" }  →  no match  →  full AI in Korean
Resolve:  { problem_text, language: "km" }  →  match     →  instant in Khmer
```

Each language builds its own independent cache.

---

## Database Schema

Table: `problem_embeddings` (pgvector required)

| Column | Type | Description |
|---|---|---|
| `id` | TEXT | Primary key |
| `session_id` | TEXT | Unique FK to `study_sessions` |
| `user_id` | TEXT | FK to `users` |
| `subject` | TEXT | e.g. "Math", "Physics" |
| `topic` | TEXT | e.g. "geometry", "kinematics" |
| `language` | TEXT | BCP-47 language code, default `"en"` |
| `problem_text` | TEXT | Original problem text |
| `embedding` | vector(768) | Normalized embedding |
| `final_answer` | TEXT | e.g. `"10 km"` |
| `solution_text` | TEXT | Full solution in user's language |
| `breakdown_json` | JSONB | Full structured breakdown |
| `feedback_count` | INTEGER | Times positively rated |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Indexes:**
- `idx_problem_embeddings_subject` — equality filter on subject
- `idx_problem_embeddings_language` — equality filter on language
- `idx_problem_embeddings_embedding` — IVFFlat approximate NN (lists=100, cosine)

---

## API

### `GET /health`
```json
{ "status": "ok" }
```

### `POST /resolve`

Check the cache before calling AI.

**Request:**
```json
{
  "problem_text": "A boat travels 6 km east, then 8 km north. Find its distance from the start.",
  "subject": "Math",
  "language": "en"
}
```

**Response:**
```json
{
  "matched": true,
  "confidence": 0.97,
  "mode": "instant",
  "session_id": "abc123",
  "final_answer": "10 km",
  "solution_text": "Using the Pythagorean theorem...",
  "breakdown_json": { ... }
}
```

`mode` values:
- `"instant"` — confidence ≥ 0.92. Caller uses `breakdown_json` directly, skips AI.
- `"hint"` — confidence ≥ 0.80. Caller injects `solution_text` as few-shot context into AI prompt.
- `"none"` — confidence < 0.80. No useful match. Full AI call.

### `POST /index`

Index a positively-rated session. Called fire-and-forget by Node backend.

**Request:**
```json
{
  "session_id": "abc123",
  "user_id": "user456",
  "problem_text": "A boat travels 6 km east, then 8 km north...",
  "subject": "Math",
  "topic": "geometry",
  "language": "en",
  "final_answer": "10 km",
  "solution_text": "Using the Pythagorean theorem...",
  "breakdown_json": { ... }
}
```

**Response:**
```json
{ "indexed": true, "session_id": "abc123" }
```

---

## Thresholds

| Constant | Value | Meaning |
|---|---|---|
| `INSTANT_THRESHOLD` | `0.92` | Cosine similarity above which the cached solution is returned directly |
| `HINT_THRESHOLD` | `0.80` | Cosine similarity above which the cached solution is injected as AI context |

Tuning guidance:
- Raise `INSTANT_THRESHOLD` → fewer cache hits, higher precision (safer)
- Lower `INSTANT_THRESHOLD` → more cache hits, risk of slightly wrong answers for edge cases

---

## Node Integration

The Node backend (`resolver.service.ts`) calls the resolver with a 1.5 s timeout. Any failure (timeout, network error, service down) silently falls through to the full AI path — the resolver is **never on the critical path**.

```
resolveFromCache(problemText, subject, language)
    │
    ├─ timeout: 1500ms
    ├─ on error / timeout → { mode: "none" }  (AI proceeds normally)
    └─ on success → use mode to branch
```

`indexSession()` is fire-and-forget — it never blocks the response to the user.

---

## Setup

### Requirements

- Python 3.12+ (3.14 is not supported — pydantic-core requires ≤ 3.13)
- PostgreSQL with `pgvector` extension enabled
- Gemini API key

### Install

```bash
cd zupiq-backend/python
~/.pyenv/versions/3.12.14/bin/python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Environment

```
GEMINI_API_KEY=...
DATABASE_URL=postgresql://...
PORT=8001
```

### Run

```bash
source venv/bin/activate
uvicorn resolver.main:app --port 8001 --reload
```

### Migrations

```bash
cd zupiq-backend
supabase db push
```

Applies in order:
1. `20260824000002_problem_embeddings.sql` — creates table + IVFFlat index
2. `20260824000003_add_language_to_problem_embeddings.sql` — adds language column

---

## File Structure

```
python/
├── resolver/
│   ├── __init__.py
│   ├── main.py       — FastAPI app, /health /resolve /index endpoints
│   ├── embedder.py   — Gemini embedding + normalization (LaTeX strip, number→N)
│   ├── db.py         — pgvector find_similar() and upsert_embedding()
│   └── models.py     — Pydantic request/response models
├── requirements.txt
├── .env
└── RESOLVER.md       — this file
```
