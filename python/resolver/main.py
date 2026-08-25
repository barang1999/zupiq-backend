from __future__ import annotations
import logging
import os
import re

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException

from .db import HINT_THRESHOLD, INSTANT_THRESHOLD, find_similar, upsert_embedding
from .embedder import embed, normalize_for_debug
from .models import IndexRequest, ResolveRequest, ResolveResponse


def _extract_numbers(text: str) -> list[str]:
    """Extract all numeric tokens from text (integers and decimals)."""
    return re.findall(r"\b\d+(?:\.\d+)?\b", text)


SEMANTIC_TOKEN_RE = re.compile(r"\b(?:sin|cos|tan|cot|sec|csc|log|ln|sqrt|fraction|pi|infinity)\b|<=|>=|!=")


def _semantic_tokens(text: str) -> set[str]:
    """Extract math tokens that must match before serving an instant cache hit."""
    return set(SEMANTIC_TOKEN_RE.findall(normalize_for_debug(text)))


def _semantic_signature_match(incoming: str, cached: str) -> tuple[bool, list[str], list[str]]:
    incoming_tokens = sorted(_semantic_tokens(incoming))
    cached_tokens = sorted(_semantic_tokens(cached))
    return incoming_tokens == cached_tokens, incoming_tokens, cached_tokens

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
    normalized_problem = normalize_for_debug(req.problem_text)
    logger.info(
        "[resolver] resolve request: subject=%s language=%s problem=%s normalized=%s",
        req.subject,
        req.language,
        req.problem_text[:160],
        normalized_problem[:160],
    )

    try:
        vec = embed(req.problem_text)
        results = find_similar(vec, subject=req.subject, language=req.language, limit=5)
    except Exception as exc:
        logger.warning("[resolver] resolve failed (non-critical): %s", exc)
        return ResolveResponse(matched=False, confidence=0.0, mode="none")

    if not results:
        logger.info(
            "[resolver] resolve no candidates after filters: subject=%s language=%s normalized=%s",
            req.subject,
            req.language,
            normalized_problem[:160],
        )
        return ResolveResponse(matched=False, confidence=0.0, mode="none")

    compatible_results = []
    for row in results:
        signature_match, incoming_tokens, cached_tokens = _semantic_signature_match(req.problem_text, str(row.get("problem_text") or ""))
        logger.info(
            "[resolver] semantic guard: match=%s incoming_tokens=%s cached_tokens=%s candidate_session=%s candidate_problem=%s",
            signature_match,
            incoming_tokens,
            cached_tokens,
            row.get("session_id"),
            str(row.get("problem_text") or "")[:120],
        )
        if signature_match:
            compatible_results.append(row)

    if not compatible_results:
        best_similarity = float(results[0]["similarity"])
        logger.info(
            "[resolver] resolve no semantically compatible candidates: best_similarity=%.4f subject=%s language=%s",
            best_similarity,
            req.subject,
            req.language,
        )
        return ResolveResponse(matched=False, confidence=best_similarity, mode="none")

    top = compatible_results[0]
    similarity = float(top["similarity"])

    logger.info(
        "[resolver] resolve top: subject=%s language=%s similarity=%.4f session_id=%s cached_problem=%s",
        req.subject,
        req.language,
        similarity,
        top.get("session_id"),
        str(top.get("problem_text") or "")[:160],
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
            "[resolver] instant guard numbers: match=%s incoming=%s cached=%s incoming_problem=%s cached_problem=%s",
            numbers_match,
            incoming_nums,
            cached_nums,
            req.problem_text[:120],
            str(top.get("problem_text") or "")[:120],
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
    normalized_problem = normalize_for_debug(req.problem_text)
    logger.info(
        "[resolver] index request: session=%s subject=%s language=%s problem=%s normalized=%s",
        req.session_id,
        req.subject,
        req.language,
        req.problem_text[:160],
        normalized_problem[:160],
    )
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
