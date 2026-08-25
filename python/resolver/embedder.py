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
    text = text.lower()

    # Preserve math operators/constants that change problem meaning before
    # removing generic LaTeX commands.
    semantic_commands = {
        r"\\sin": " sin ",
        r"\\cos": " cos ",
        r"\\tan": " tan ",
        r"\\cot": " cot ",
        r"\\sec": " sec ",
        r"\\csc": " csc ",
        r"\\log": " log ",
        r"\\ln": " ln ",
        r"\\sqrt": " sqrt ",
        r"\\pi": " pi ",
        r"\\theta": " theta ",
        r"\\alpha": " alpha ",
        r"\\beta": " beta ",
        r"\\gamma": " gamma ",
        r"\\leq": " <= ",
        r"\\geq": " >= ",
        r"\\neq": " != ",
        r"\\infty": " infinity ",
    }
    for pattern, replacement in semantic_commands.items():
        text = re.sub(pattern, replacement, text)

    # Keep fraction structure instead of dropping \frac entirely.
    text = re.sub(r"\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}", r" fraction \1 over \2 ", text)

    # Strip LaTeX formatting
    text = re.sub(r"\$\$|\\\[|\\\]", " ", text)
    text = re.sub(r"\$|\\\(|\\\)", " ", text)
    text = re.sub(r"\\[a-zA-Z]+", " ", text)   # strip remaining formatting commands
    text = re.sub(r"[{}]", " ", text)

    # Replace numeric literals (integers and decimals) with placeholder N.
    text = re.sub(r"\b\d+(?:\.\d+)?\b", "N", text)

    text = re.sub(r"\s+", " ", text)
    return text.strip()


def normalize_for_debug(text: str) -> str:
    """Expose the embedding normalization for resolver diagnostics."""
    return _normalize_for_embedding(text)


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
