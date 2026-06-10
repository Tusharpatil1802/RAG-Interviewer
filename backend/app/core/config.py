from functools import lru_cache
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    app_name: str = "RoleRAG Interviewer"
    database_url: str = "sqlite:///./interview.db"
    chroma_dir: str = "./data/chroma"
    upload_dir: str = "./data/uploads"
    kb_dir: str = "./data/kb_docs"
    embedding_provider: str = "local"
    embedding_model: str = "all-MiniLM-L6-v2"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"
    max_turns: int = 5

    class Config:
        env_file = ".env"
        extra = "ignore"

@lru_cache
def get_settings() -> Settings:
    return Settings()
