from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
import psycopg2

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from resolver.embedder import embed, normalize_for_debug  # noqa: E402


def _get_conn():
    dsn = re.sub(r"[&?]pgbouncer=true", "", os.environ["DATABASE_URL"])
    return psycopg2.connect(dsn)


def _vec_literal(embedding: list[float]) -> str:
    return "[" + ",".join(str(v) for v in embedding) + "]"


def reindex(limit: int | None, dry_run: bool) -> None:
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, session_id, problem_text
                FROM problem_embeddings
                ORDER BY updated_at DESC
                LIMIT COALESCE(%s, 2147483647)
                """,
                (limit,),
            )
            rows = cur.fetchall()

            print(f"found {len(rows)} problem_embeddings rows")
            for index, (row_id, session_id, problem_text) in enumerate(rows, start=1):
                normalized = normalize_for_debug(problem_text or "")
                print(f"[{index}/{len(rows)}] session={session_id} normalized={normalized[:140]}")
                if dry_run:
                    continue

                vector = _vec_literal(embed(problem_text or ""))
                cur.execute(
                    """
                    UPDATE problem_embeddings
                    SET embedding = %s::vector,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (vector, row_id),
                )
                conn.commit()
    finally:
        conn.close()


def main() -> None:
    load_dotenv(ROOT / ".env")
    parser = argparse.ArgumentParser(description="Recompute semantic resolver embeddings with the current normalizer.")
    parser.add_argument("--limit", type=int, default=None, help="Only reindex the most recently updated N rows.")
    parser.add_argument("--dry-run", action="store_true", help="Print normalized text without updating embeddings.")
    args = parser.parse_args()
    reindex(limit=args.limit, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
