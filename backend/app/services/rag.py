from __future__ import annotations
from pathlib import Path
from typing import Iterable
import hashlib
import chromadb
from chromadb.utils.embedding_functions import SentenceTransformerEmbeddingFunction
from pypdf import PdfReader
from app.core.config import get_settings

settings = get_settings()

ROLE_COLLECTIONS = {
    "AI/ML Engineer": "kb_ai_ml",
    "Backend Engineer": "kb_backend",
    "Data Science / Applied ML": "kb_data_science",
}

Path(settings.chroma_dir).mkdir(parents=True, exist_ok=True)
_CHROMA_CLIENT = chromadb.PersistentClient(path=settings.chroma_dir)
_EMBEDDER = SentenceTransformerEmbeddingFunction(model_name=settings.embedding_model)

def read_document(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        reader = PdfReader(str(path))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    return path.read_text(encoding="utf-8", errors="ignore")

def collection_for_role(role: str):
    collection_name = ROLE_COLLECTIONS.get(role, f"kb_{role.lower().replace(' ', '_').replace('/', '_')}")
    return _CHROMA_CLIENT.get_or_create_collection(collection_name, embedding_function=_EMBEDDER)

def chunk_text(text: str, chunk_size: int = 950, overlap: int = 160) -> list[str]:
    words = text.split()
    chunks, start = [], 0
    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunks.append(" ".join(words[start:end]))
        if end == len(words):
            break
        start = max(0, end - overlap)
    return [c for c in chunks if len(c) > 120]

def ingest_knowledge_base(role: str | None = None) -> dict:
    kb_dir = Path(settings.kb_dir)
    kb_dir.mkdir(parents=True, exist_ok=True)
    role_dirs = [kb_dir / role] if role else [p for p in kb_dir.iterdir() if p.is_dir()]
    total = 0
    for rdir in role_dirs:
        if not rdir.exists():
            continue
        col = collection_for_role(rdir.name)
        for doc in list(rdir.glob("*.pdf")) + list(rdir.glob("*.txt")) + list(rdir.glob("*.md")):
            chunks = chunk_text(read_document(doc))
            ids = [hashlib.sha1(f"{doc}:{i}:{c[:80]}".encode()).hexdigest() for i, c in enumerate(chunks)]
            if chunks:
                col.upsert(ids=ids, documents=chunks, metadatas=[{"source": doc.name, "role": rdir.name, "chunk": i} for i in range(len(chunks))])
                total += len(chunks)
    return {"chunks_ingested": total, "roles_scanned": [p.name for p in role_dirs if p.exists()]}


def build_queries(role: str, resume_profile: dict, last_answer: str | None = None) -> list[str]:
    skills = resume_profile.get("skills", [])
    projects = resume_profile.get("projects", [])
    experience = resume_profile.get("years_experience") or resume_profile.get("seniority_signal") or "entry-level"
    domains = resume_profile.get("domains", [])
    role_topics = {
        "AI/ML Engineer": "modeling, data pipelines, evaluation, experimentation, and deployment",
        "Backend Engineer": "apis, databases, reliability, debugging, and service design",
        "Data Science / Applied ML": "analysis, experimentation, feature engineering, and model delivery",
    }
    role_topic = role_topics.get(role, "practical role-specific engineering concepts")

    queries = []

    if skills:
        queries.append(f"{role} interview concepts for {', '.join(skills[:5])}")
        queries.append(f"practical debugging and design scenarios using {', '.join(skills[:4])}")

    if projects:
        queries.append(f"{role} concepts related to candidate project: {projects[0]}")

    if domains:
        queries.append(f"{role} interview topics covering {', '.join(domains[:3])}")

    queries.append(f"{role} {experience} interview topics covering {role_topic}")

    if last_answer:
        queries.append(f"follow up question based on candidate answer: {last_answer[:300]}")

    return queries

def retrieve(role: str, queries: Iterable[str], k: int = 4) -> list[dict]:
    col = collection_for_role(role)
    results = []
    for q in queries:
        res = col.query(query_texts=[q], n_results=k)
        for doc, meta, dist in zip(res.get("documents", [[]])[0], res.get("metadatas", [[]])[0], res.get("distances", [[]])[0]):
            results.append({"text": doc[:1200], "metadata": meta, "distance": dist, "query": q})
    seen, dedup = set(), []
    for r in results:
        key = (r["metadata"].get("source"), r["metadata"].get("chunk"))
        if key not in seen:
            dedup.append(r)
            seen.add(key)
    return dedup[:k]
