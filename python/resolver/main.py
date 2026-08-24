from __future__ import annotations
import logging
import os
import re

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException

from .db import HINT_THRESHOLD, INSTANT_THRESHOLD, find_similar, upsert_embedding
from .embedder import embed
from .models import IndexRequest, ResolveRequest, ResolveResponse


def _extract_numbers(text: str) -> list[str]:
    """Extract all numeric tokens from text (integers and decimals)."""
    return re.findall(r"\b\d+(?:\.\d+)?\b", text)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Zupiq Resolver", version="1.0.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/resolve", response_model=ResolveResponse)
def resolve(req: ResolveRequest) -> ResolveResponse:
    """
    Semantic cache lookup.

    Returns mode='instant' when similarity ≥ 0.92 — caller should use the
    cached breakdown_json directly without calling AI.

    Returns mode='hint' when 0.80 ≤ similarity < 0.92 — caller should
    inject solution_text as few-shot context into the AI prompt.

    Returns mode='none' when similarity < 0.80 — no useful match.
    """
    try:
        vec = embed(req.problem_text)
        results = find_similar(vec, subject=req.subject, language=req.language, limit=1)
    except Exception as exc:
        logger.warning("[resolver] resolve failed (non-critical): %s", exc)
        return ResolveResponse(matched=False, confidence=0.0, mode="none")

    if not results:
        return ResolveResponse(matched=False, confidence=0.0, mode="none")

    top = results[0]
    similarity = float(top["similarity"])

    logger.info(
        "[resolver] resolve: subject=%s similarity=%.4f",
        req.subject,
        similarity,
    )

    if similarity >= INSTANT_THRESHOLD:
        # Guard: if the numbers differ between the incoming problem and the
        # cached one, the structure is the same but the values are not —
        # serving the cached solution would return wrong calculations.
        # Downgrade to hint so AI solves fresh with the cached solution as context.
        incoming_nums = sorted(_extract_numbers(req.problem_text))
        cached_nums   = sorted(_extract_numbers(top.get("problem_text") or ""))
        numbers_match = (incoming_nums == cached_nums)

        logger.info(
            "[resolver] numbers check: match=%s incoming=%s cached=%s",
            numbers_match, incoming_nums, cached_nums,
        )

        if numbers_match:
            return ResolveResponse(
                matched=True,
                confidence=similarity,
                mode="instant",
                session_id=str(top["session_id"]),
                final_answer=top.get("final_answer"),
                solution_text=top.get("solution_text"),
                breakdown_json=top.get("breakdown_json"),
            )
        else:
            # Same problem pattern, different numbers — use as hint only.
            return ResolveResponse(
                matched=True,
                confidence=similarity,
                mode="hint",
                session_id=str(top["session_id"]),
                final_answer=None,
                solution_text=top.get("solution_text"),
                breakdown_json=None,
            )

    if similarity >= HINT_THRESHOLD:
        return ResolveResponse(
            matched=True,
            confidence=similarity,
            mode="hint",
            session_id=str(top["session_id"]),
            final_answer=top.get("final_answer"),
            solution_text=top.get("solution_text"),
            breakdown_json=None,  # full breakdown withheld for hint mode
        )

    return ResolveResponse(matched=False, confidence=similarity, mode="none")


@app.post("/index")
def index(req: IndexRequest):
    """Index a positively-rated session into the embedding store."""
    try:
        vec = embed(req.problem_text)
        upsert_embedding(
            session_id=req.session_id,
            user_id=req.user_id,
            problem_text=req.problem_text,
            embedding=vec,
            subject=req.subject,
            topic=req.topic,
            language=req.language,
            final_answer=req.final_answer,
            solution_text=req.solution_text,
            breakdown_json=req.breakdown_json,
        )
        logger.info("[resolver] indexed session %s (%s)", req.session_id, req.subject)
        return {"indexed": True, "session_id": req.session_id}
    except Exception as exc:
        logger.error("[resolver] index error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))
