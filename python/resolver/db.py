from __future__ import annotations
import json
import logging
import os
import re
from typing import Any, Optional

import psycopg2
from psycopg2.extras import RealDictCursor

# Similarity thresholds
INSTANT_THRESHOLD = 0.92   # return cached solution directly
HINT_THRESHOLD    = 0.80   # inject as few-shot context into AI prompt

logger = logging.getLogger(__name__)


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
            conditions.append("LOWER(subject) = LOWER(%s)")
            params.append(subject)

        if language:
            conditions.append("LOWER(language) = LOWER(%s)")
            params.append(language)

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE %s::text IS NULL OR LOWER(subject) = LOWER(%s::text)) AS subject_count,
                    COUNT(*) FILTER (WHERE %s::text IS NULL OR LOWER(language) = LOWER(%s::text)) AS language_count,
                    COUNT(*) FILTER (
                        WHERE (%s::text IS NULL OR LOWER(subject) = LOWER(%s::text))
                          AND (%s::text IS NULL OR LOWER(language) = LOWER(%s::text))
                    ) AS filtered_count
                FROM problem_embeddings
                """,
                (subject, subject, language, language, subject, subject, language, language),
            )
            counts = dict(cur.fetchone() or {})
            logger.info(
                "[resolver.db] lookup filters: subject=%s language=%s counts=%s",
                subject,
                language,
                counts,
            )

            cur.execute(
                f"""
                SELECT
                    session_id,
                    subject,
                    language,
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
            rows = [dict(row) for row in cur.fetchall()]
            logger.info(
                "[resolver.db] filtered candidates: count=%s top=%s",
                len(rows),
                [
                    {
                        "session_id": row.get("session_id"),
                        "subject": row.get("subject"),
                        "language": row.get("language"),
                        "similarity": float(row.get("similarity") or 0),
                        "problem_text": str(row.get("problem_text") or "")[:120],
                    }
                    for row in rows[:3]
                ],
            )

            if not rows and (subject or language):
                cur.execute(
                    """
                    SELECT
                        session_id,
                        subject,
                        language,
                        problem_text,
                        1 - (embedding <=> %s::vector) AS similarity
                    FROM problem_embeddings
                    ORDER BY embedding <=> %s::vector
                    LIMIT 3
                    """,
                    (vec, vec),
                )
                logger.info(
                    "[resolver.db] unfiltered nearest candidates: %s",
                    [
                        {
                            "session_id": row.get("session_id"),
                            "subject": row.get("subject"),
                            "language": row.get("language"),
                            "similarity": float(row.get("similarity") or 0),
                            "problem_text": str(row.get("problem_text") or "")[:120],
                        }
                        for row in cur.fetchall()
                    ],
                )

            return rows
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
                    vec, (language or "en").lower(), final_answer, solution_text, bj,
                ),
            )
        conn.commit()
    finally:
        conn.close()
