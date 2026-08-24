from __future__ import annotations
import json
import os
import re
from typing import Any, Optional

import psycopg2
from psycopg2.extras import RealDictCursor

# Similarity thresholds
INSTANT_THRESHOLD = 0.92   # return cached solution directly
HINT_THRESHOLD    = 0.80   # inject as few-shot context into AI prompt


def _get_conn():
    # Strip pgbouncer=true — it's a Supabase hint for their pooler proxy,
    # not a valid psycopg2 DSN parameter.
    dsn = re.sub(r"[&?]pgbouncer=true", "", os.environ["DATABASE_URL"])
    return psycopg2.connect(dsn)


def _vec_literal(embedding: list[float]) -> str:
    return "[" + ",".join(str(v) for v in embedding) + "]"


def find_similar(
    embedding: list[float],
    subject: Optional[str] = None,
    language: Optional[str] = None,
    limit: int = 1,
) -> list[dict[str, Any]]:
    """Return up to `limit` rows ordered by cosine similarity (descending).

    Filters by subject and language. Language is also returned in the result
    so the caller can inspect it if needed.
    """
    conn = _get_conn()
    try:
        vec = _vec_literal(embedding)
        conditions = []
        params: list[Any] = [vec]

        if subject:
            conditions.append("subject = %s")
            params.append(subject)

        if language:
            conditions.append("language = %s")
            params.append(language)

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT
                    session_id,
                    problem_text,
                    final_answer,
                    solution_text,
                    breakdown_json,
                    1 - (embedding <=> %s::vector) AS similarity
                FROM problem_embeddings
                {where}
                ORDER BY embedding <=> %s::vector
                LIMIT %s
                """,
                (*params, vec, limit),
            )
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


def upsert_embedding(
    *,
    session_id: str,
    user_id: str,
    problem_text: str,
    embedding: list[float],
    subject: Optional[str],
    topic: Optional[str],
    language: str = "en",
    final_answer: Optional[str],
    solution_text: Optional[str],
    breakdown_json: Optional[dict],
) -> None:
    conn = _get_conn()
    try:
        vec = _vec_literal(embedding)
        bj = json.dumps(breakdown_json) if breakdown_json else None
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO problem_embeddings
                    (session_id, user_id, subject, topic, problem_text,
                     embedding, language, final_answer, solution_text,
                     breakdown_json, feedback_count, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s::vector, %s, %s, %s, %s, 1, NOW())
                ON CONFLICT (session_id) DO UPDATE SET
                    embedding      = EXCLUDED.embedding,
                    problem_text   = EXCLUDED.problem_text,
                    language       = EXCLUDED.language,
                    final_answer   = EXCLUDED.final_answer,
                    solution_text  = EXCLUDED.solution_text,
                    breakdown_json = EXCLUDED.breakdown_json,
                    feedback_count = problem_embeddings.feedback_count + 1,
                    updated_at     = NOW()
                """,
                (
                    session_id, user_id, subject, topic, problem_text,
                    vec, language, final_answer, solution_text, bj,
                ),
            )
        conn.commit()
    finally:
        conn.close()
