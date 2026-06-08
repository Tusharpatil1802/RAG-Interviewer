from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from sqlalchemy.sql import func
from app.core.config import get_settings

settings = get_settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()

class InterviewSession(Base):
    __tablename__ = "interview_sessions"
    id = Column(Integer, primary_key=True)
    candidate_name = Column(String(255), nullable=True)
    role = Column(String(100), nullable=False)
    resume_text = Column(Text, nullable=False)
    extracted_profile = Column(JSON, nullable=False, default={})
    summary = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    turns = relationship("InterviewTurn", back_populates="session", cascade="all, delete-orphan")

class InterviewTurn(Base):
    __tablename__ = "interview_turns"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("interview_sessions.id"), nullable=False)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=True)
    retrieved_context = Column(JSON, nullable=False, default=[])
    evaluation = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    session = relationship("InterviewSession", back_populates="turns")

def init_db() -> None:
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
