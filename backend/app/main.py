from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import get_settings
from app.models.db import init_db
from app.api.interview import router

settings = get_settings()
app = FastAPI(title=settings.app_name)
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(',')], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.include_router(router)

@app.on_event("startup")
def startup():
    init_db()

@app.get("/health")
def health():
    return {"status": "ok"}
