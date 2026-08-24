from __future__ import annotations
import os
import re
import httpx

EMBEDDING_MODEL = "models/gemini-embedding-001"
EMBEDDING_DIMS = 768


def _normalize_for_embedding(text: str) -> str:
    """
    Strip LaTeX delimiters and replace concrete numbers with a placeholder
    so the embedding captures problem *structure* rather than specific values.

    "Solve 2x² + 5x + 3 = 0" and "Solve 4x² + 7x + 2 = 0" both become
    "Solve Nx² + Nx + N = 0" and get nearly identical vectors.
    """
    # Strip LaTeX formatting
    text = re.sub(r"\$\$|\\\[|\\\]", " ", text)
    text = re.sub(r"\$|\\\(|\\\)", " ", text)
    text = re.sub(r"\\[a-zA-Z]+", " ", text)   # strip commands like \frac \int
    text = re.sub(r"[{}]", " ", text)

    # Replace numeric literals (integers and decimals) with placeholder N.
    text = re.sub(r"\b\d+(?:\.\d+)?\b", "N", text)

    text = re.sub(r"\s+", " ", text)
    return text.strip()


def embed(text: str) -> list[float]:
    """Return a 768-dim embedding vector for the given problem text."""
    normalized = _normalize_for_embedding(text)
    content = normalized or text

    api_key = os.environ["GEMINI_API_KEY"]
    resp = httpx.post(
        f"https://generativelanguage.googleapis.com/v1/{EMBEDDING_MODEL}:embedContent",
        params={"key": api_key},
        json={
            "model": EMBEDDING_MODEL,
            "content": {"parts": [{"text": content}]},
            "taskType": "SEMANTIC_SIMILARITY",
            "outputDimensionality": EMBEDDING_DIMS,
        },
        timeout=10.0,
    )
    resp.raise_for_status()
    return resp.json()["embedding"]["values"]
