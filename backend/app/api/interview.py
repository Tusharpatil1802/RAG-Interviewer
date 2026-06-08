from pathlib import Path
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.orm import Session
from app.core.config import get_settings
from app.models.db import get_db, InterviewSession, InterviewTurn
from app.schemas.interview import AnswerRequest, AnswerResponse, StartInterviewResponse, SessionSummary
from app.services.resume import extract_text_from_file, parse_resume
from app.services.rag import build_queries, retrieve, ingest_knowledge_base
from app.services.llm import generate_question, evaluate_answer, summarize_session

router = APIRouter(prefix="/api", tags=["interview"])
settings = get_settings()

@router.post("/kb/ingest")
def ingest(role: str | None = None):
    return ingest_knowledge_base(role)

@router.post("/interviews/start", response_model=StartInterviewResponse)
async def start_interview(role: str = Form(...), resume: UploadFile = File(...), db: Session = Depends(get_db)):
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    if not (resume.filename or "").lower().endswith((".pdf", ".txt")):
        raise HTTPException(400, "Upload a PDF or TXT resume")
    safe_name = Path(resume.filename).name
    path = Path(settings.upload_dir) / safe_name
    path.write_bytes(await resume.read())
    text = extract_text_from_file(str(path))
    if len(text) < 50:
        raise HTTPException(400, "Could not extract enough resume text")
    profile = parse_resume(text)
    session = InterviewSession(role=role, resume_text=text, extracted_profile=profile, candidate_name=profile.get("name"))
    db.add(session)
    db.commit()
    db.refresh(session)
    context = retrieve(role, build_queries(role, profile), k=5)
    question = generate_question(role, profile, context, previous_questions=[], turn_number=1)
    turn = InterviewTurn(session_id=session.id, question=question, retrieved_context=context)
    db.add(turn)
    db.commit()
    return {
        "session_id": session.id,
        "profile": profile,
        "question": question,
        "context_sources": [c["metadata"] for c in context],
        "max_turns": settings.max_turns,
        "created_at": session.created_at,
    }

@router.post("/interviews/{session_id}/answer", response_model=AnswerResponse)
def submit_answer(session_id: int, req: AnswerRequest, db: Session = Depends(get_db)):
    session = db.get(InterviewSession, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    answer = req.answer.strip()
    if len(answer) < 10:
        raise HTTPException(400, "Answer is too short")
    current = db.query(InterviewTurn).filter_by(session_id=session_id, answer=None).order_by(InterviewTurn.id.desc()).first()
    if not current:
        raise HTTPException(400, "No pending question")
    current.answer = answer
    current.evaluation = evaluate_answer(current.question, answer, current.retrieved_context or [])
    db.flush()
    completed = db.query(InterviewTurn).filter(InterviewTurn.session_id == session_id, InterviewTurn.answer != None).count()
    next_question = None
    next_context = []
    if completed < settings.max_turns:
        previous_questions = [t.question for t in session.turns if t.question]
        context = retrieve(session.role, build_queries(session.role, session.extracted_profile, answer), k=5)
        next_context = context
        next_question = generate_question(
            session.role,
            session.extracted_profile,
            context,
            previous_questions=previous_questions,
            turn_number=completed + 1,
            last_answer=answer,
        )
        db.add(InterviewTurn(session_id=session.id, question=next_question, retrieved_context=context))
    else:
        session.summary = summarize_session(session.role, session.extracted_profile, session.turns)
    db.commit()
    return {
        "evaluation": current.evaluation,
        "next_question": next_question,
        "context_sources": [c["metadata"] for c in next_context],
        "done": completed >= settings.max_turns,
        "completed_turns": completed,
        "max_turns": settings.max_turns,
    }

@router.get("/interviews/{session_id}", response_model=SessionSummary)
def get_session(session_id: int, db: Session = Depends(get_db)):
    session = db.get(InterviewSession, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    completed = len([t for t in session.turns if t.answer])
    return {
        "session_id": session.id,
        "role": session.role,
        "profile": session.extracted_profile,
        "created_at": session.created_at,
        "completed_turns": completed,
        "max_turns": settings.max_turns,
        "turns": [
            {
                "question": t.question,
                "answer": t.answer,
                "evaluation": t.evaluation,
                "created_at": t.created_at,
                "context_sources": [c.get("metadata") for c in (t.retrieved_context or [])],
            }
            for t in session.turns
        ],
        "summary": session.summary,
    }

@router.post("/interviews/{session_id}/reset")
def reset_session(session_id: int, db: Session = Depends(get_db)):
    session = db.get(InterviewSession, session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    role, profile = session.role, session.extracted_profile
    db.query(InterviewTurn).filter(InterviewTurn.session_id == session_id).delete()
    session.summary = None
    context = retrieve(role, build_queries(role, profile), k=5)
    question = generate_question(role, profile, context, previous_questions=[], turn_number=1)
    db.add(InterviewTurn(session_id=session.id, question=question, retrieved_context=context))
    db.commit()
    return {
        "session_id": session.id,
        "question": question,
        "context_sources": [c["metadata"] for c in context],
        "message": "Interview reset with a fresh first question.",
    }
