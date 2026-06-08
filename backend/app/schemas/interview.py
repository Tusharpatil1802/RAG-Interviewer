from datetime import datetime
from pydantic import BaseModel

class StartInterviewResponse(BaseModel):
    session_id: int
    profile: dict
    question: str
    context_sources: list[dict]
    max_turns: int
    created_at: datetime | None = None

class AnswerRequest(BaseModel):
    answer: str

class AnswerResponse(BaseModel):
    evaluation: dict
    next_question: str | None = None
    context_sources: list[dict] = []
    done: bool = False
    completed_turns: int
    max_turns: int

class SessionSummary(BaseModel):
    session_id: int
    role: str
    profile: dict
    created_at: datetime | None = None
    completed_turns: int
    max_turns: int
    turns: list[dict]
    summary: str | None
