from __future__ import annotations
from functools import lru_cache
from pathlib import Path
from typing import Iterable
import hashlib
import chromadb
from chromadb.utils.embedding_functions import OpenAIEmbeddingFunction, SentenceTransformerEmbeddingFunction
from pypdf import PdfReader
from app.core.config import get_settings

settings = get_settings()

ROLE_COLLECTIONS = {
    "AI/ML Engineer": "kb_ai_ml",
    "Backend Engineer": "kb_backend",
    "Data Science / Applied ML": "kb_data_science",
}

ROLE_DIRECTORIES = {
    "AI/ML Engineer": "AI_ML_Engineer",
    "Backend Engineer": "Backend_Engineer",
    "Data Science / Applied ML": "Data_Science_Applied_ML",
}
KNOWN_ROLE_DIRECTORY_NAMES = set(ROLE_DIRECTORIES.values())

Path(settings.chroma_dir).mkdir(parents=True, exist_ok=True)
_CHROMA_CLIENT = chromadb.PersistentClient(path=settings.chroma_dir)


class EmbeddingConfigurationError(RuntimeError):
    pass


def _model_slug(value: str) -> str:
    return value.lower().replace("/", "_").replace("-", "_").replace(".", "_").replace(" ", "_")


@lru_cache
def get_embedder():
    provider = settings.embedding_provider.lower().strip()
    if provider == "openai":
        if not settings.openai_api_key:
            raise EmbeddingConfigurationError(
                "OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai"
            )
        return OpenAIEmbeddingFunction(
            api_key=settings.openai_api_key,
            model_name=settings.embedding_model,
        )
    if provider in {"sentence-transformer", "sentence_transformer", "local"}:
        try:
            return SentenceTransformerEmbeddingFunction(model_name=settings.embedding_model)
        except Exception as exc:
            raise EmbeddingConfigurationError(
                "Local embedding model could not be initialized. On first run, ensure internet access is available "
                "to download the sentence-transformer model or pre-cache it locally."
            ) from exc
    raise EmbeddingConfigurationError(
        f"Unsupported embedding provider: {settings.embedding_provider}"
    )

def read_document(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        reader = PdfReader(str(path))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    return path.read_text(encoding="utf-8", errors="ignore")


def role_directory_name(role: str) -> str:
    return ROLE_DIRECTORIES.get(role, role.replace("/", "_").strip())


def role_from_directory_name(directory_name: str) -> str:
    for role, mapped_name in ROLE_DIRECTORIES.items():
        if mapped_name == directory_name:
            return role
    return directory_name.replace("_", " ")


def collection_for_role(role: str):
    base_name = ROLE_COLLECTIONS.get(role, f"kb_{role.lower().replace(' ', '_').replace('/', '_')}")
    provider_slug = _model_slug(settings.embedding_provider)
    model_slug = _model_slug(settings.embedding_model)
    collection_name = f"{base_name}_{provider_slug}_{model_slug}"
    return _CHROMA_CLIENT.get_or_create_collection(collection_name, embedding_function=get_embedder())

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
    if role:
        role_dirs = [(role, kb_dir / role_directory_name(role))]
    else:
        role_dirs = [
            (role_from_directory_name(path.name), path)
            for path in kb_dir.iterdir()
            if path.is_dir() and path.name in KNOWN_ROLE_DIRECTORY_NAMES
        ]
    total = 0
    scanned_roles = []
    for role_name, rdir in role_dirs:
        if not rdir.exists():
            continue
        scanned_roles.append(role_name)
        col = collection_for_role(role_name)
        for doc in list(rdir.glob("*.pdf")) + list(rdir.glob("*.txt")) + list(rdir.glob("*.md")):
            chunks = chunk_text(read_document(doc))
            ids = [hashlib.sha1(f"{doc}:{i}:{c[:80]}".encode()).hexdigest() for i, c in enumerate(chunks)]
            if chunks:
                col.upsert(ids=ids, documents=chunks, metadatas=[{"source": doc.name, "role": role_name, "chunk": i} for i in range(len(chunks))])
                total += len(chunks)
    return {"chunks_ingested": total, "roles_scanned": scanned_roles}


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
