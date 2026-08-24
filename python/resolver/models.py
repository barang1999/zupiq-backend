from __future__ import annotations
from typing import Any, Dict, Optional
from pydantic import BaseModel


class ResolveRequest(BaseModel):
    problem_text: str
    subject: Optional[str] = None
    language: Optional[str] = "en"


class ResolveResponse(BaseModel):
    matched: bool
    confidence: float
    mode: str  # "instant" | "hint" | "none"
    session_id: Optional[str] = None
    final_answer: Optional[str] = None
    solution_text: Optional[str] = None
    breakdown_json: Optional[Dict[str, Any]] = None


class IndexRequest(BaseModel):
    session_id: str
    user_id: str
    problem_text: str
    subject: Optional[str] = None
    topic: Optional[str] = None
    language: str = "en"
    final_answer: Optional[str] = None
    solution_text: Optional[str] = None
    breakdown_json: Optional[Dict[str, Any]] = None
