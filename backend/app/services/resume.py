import re
import json
from pathlib import Path
from pypdf import PdfReader
from app.services.llm import client_or_none, safe_json_loads
from app.core.config import get_settings

settings = get_settings()

SECTION_STOP_HEADERS = {
    "SUMMARY", "INTERNSHIP EXPERIENCE", "EXPERIENCE", "WORK EXPERIENCE", "PROJECTS",
    "EDUCATION", "SKILLS", "CERTIFICATIONS", "ACHIEVEMENTS & ACTIVITIES", "ACHIEVEMENTS",
    "ACTIVITIES"
}

SKILL_HINTS = [
    "python", "java", "javascript", "typescript", "react", "next.js", "fastapi", "flask", "django",
    "sql", "postgresql", "mongodb", "docker", "kubernetes", "aws", "azure", "gcp",
    "machine learning", "deep learning", "nlp", "computer vision", "pandas", "numpy", "scikit-learn",
    "tensorflow", "pytorch", "rag", "llm", "vector database", "redis", "microservices"
]

def extract_text_from_file(path: str) -> str:
    p = Path(path)
    if p.suffix.lower() == ".pdf":
        reader = PdfReader(str(p))
        return "\n".join(page.extract_text() or "" for page in reader.pages).strip()
    return p.read_text(encoding="utf-8", errors="ignore").strip()


def _clean_line(line: str) -> str:
    cleaned = line.replace("\x7f", " ").replace("\uf0b7", " ").replace("•", " ").strip(" -|\t")
    return re.sub(r"\s+", " ", cleaned).strip()


def _normalized_lines(text: str) -> list[str]:
    return [_clean_line(line) for line in text.splitlines() if _clean_line(line)]


def _section_lines(lines: list[str], section_name: str) -> list[str]:
    try:
        start = next(i for i, line in enumerate(lines) if line.upper() == section_name)
    except StopIteration:
        return []
    collected = []
    for line in lines[start + 1:]:
        if line.upper() in SECTION_STOP_HEADERS:
            break
        collected.append(line)
    return collected


def _looks_like_title(line: str) -> bool:
    if not line or ":" in line:
        return False
    words = line.split()
    if len(words) < 2 or len(words) > 8 or len(line) > 80:
        return False
    if line.endswith(".") or not line[0].isupper():
        return False
    if re.search(r"\b(202\d|20\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b", line.lower()):
        return False
    lowered = line.lower()
    blocked_starts = {
        "built", "designed", "implemented", "selected", "wrote", "evaluated", "generated",
        "trained", "engineered", "applied", "performed", "assisted", "collaborated", "developed",
        "produced", "served"
    }
    if words[0].lower() in blocked_starts:
        return False
    capitalized_words = sum(1 for word in words if word[:1].isupper() or any(ch.isupper() for ch in word[1:]))
    return capitalized_words >= max(2, len(words) // 2)


def _extract_projects(lines: list[str]) -> tuple[list[str], list[dict]]:
    project_lines = _section_lines(lines, "PROJECTS")
    if not project_lines:
        return [], []

    projects = []
    current = None
    for line in project_lines:
        if _looks_like_title(line):
            if current and current["bullets"]:
                projects.append(current)
            current = {"title": line, "bullets": []}
            continue
        if current is None:
            continue
        current["bullets"].append(line)

    if current and current["bullets"]:
        projects.append(current)

    summarized = []
    details = []
    for project in projects[:5]:
        bullets = project["bullets"][:3]
        summary = f"{project['title']}: {' '.join(bullets)[:280]}".strip()
        summarized.append(summary)
        details.append({"title": project["title"], "bullets": bullets})
    return summarized, details


def _extract_experience_highlights(lines: list[str]) -> list[str]:
    experience_lines = _section_lines(lines, "INTERNSHIP EXPERIENCE") or _section_lines(lines, "EXPERIENCE")
    return experience_lines[:8]


def _extract_summary(lines: list[str]) -> str | None:
    summary_lines = _section_lines(lines, "SUMMARY")
    if not summary_lines:
        return None
    return " ".join(summary_lines[:4])[:500]


def _extract_skill_categories(lines: list[str]) -> dict:
    skill_lines = _section_lines(lines, "SKILLS")
    categories = {}
    for line in skill_lines:
        if ":" not in line:
            continue
        category, values = line.split(":", 1)
        parsed = [value.strip() for value in values.split(",") if value.strip()]
        if parsed:
            categories[category.strip()] = parsed
    return categories

def _fallback_parse(text: str) -> dict:
    lowered = text.lower()
    lines = _normalized_lines(text)
    skills = sorted({skill for skill in SKILL_HINTS if skill in lowered})
    emails = re.findall(r"[\w.+-]+@[\w-]+\.[\w.-]+", text)
    phones = re.findall(r"(?:\+?\d[\d\-\s]{8,}\d)", text)
    possible_names = []
    for line in lines[:12]:
        clean = line.strip(" -|\t")
        if 2 <= len(clean.split()) <= 4 and not any(x in clean.lower() for x in ["email", "phone", "resume", "linkedin", "github", "http"]):
            possible_names.append(clean)
    domains = []
    for domain, keys in {
        "backend": ["api", "database", "microservice", "fastapi", "django", "flask"],
        "ai_ml": ["machine learning", "deep learning", "model", "nlp", "computer vision", "rag"],
        "frontend": ["react", "next", "ui", "frontend"],
        "cloud_devops": ["docker", "kubernetes", "aws", "ci/cd", "deployment"],
    }.items():
        if any(k in lowered for k in keys):
            domains.append(domain)
    years = re.findall(r"(\d+(?:\.\d+)?)\+?\s*(?:years|yrs)", lowered)
    projects, project_details = _extract_projects(lines)
    experience_highlights = _extract_experience_highlights(lines)
    summary = _extract_summary(lines)
    skill_categories = _extract_skill_categories(lines)
    return {
        "name": possible_names[0] if possible_names else None,
        "emails": emails[:3],
        "phones": phones[:2],
        "skills": skills,
        "years_experience": years[0] if years else None,
        "domains": domains,
        "projects": projects,
        "project_details": project_details,
        "experience_highlights": experience_highlights,
        "skill_categories": skill_categories,
        "summary": summary or "Fallback extraction used. Add OPENAI_API_KEY for richer JSON profile extraction."
    }

def parse_resume(text: str) -> dict:
    client = client_or_none()
    fallback = _fallback_parse(text)
    if not client:
        return fallback

    prompt = f"""Extract a structured candidate profile from this resume text.
Return valid JSON only with keys:
name, emails, phones, skills, years_experience, domains, projects, seniority_signal, summary.
- skills: concise normalized technology/concept names
- domains: areas such as backend, ai_ml, data_science, frontend, cloud_devops
- projects: up to 5 short project/domain bullets
- seniority_signal: beginner, intern, junior, mid, senior, or unknown
Resume text:
{text[:12000]}"""
    try:
        resp = client.chat.completions.create(
            model=settings.openai_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        parsed = safe_json_loads(resp.choices[0].message.content, fallback)
        parsed.setdefault("emails", fallback["emails"])
        parsed.setdefault("phones", fallback["phones"])
        parsed.setdefault("skills", fallback["skills"])
        parsed.setdefault("domains", fallback["domains"])
        parsed.setdefault("projects", fallback["projects"])
        parsed.setdefault("project_details", fallback["project_details"])
        parsed.setdefault("experience_highlights", fallback["experience_highlights"])
        parsed.setdefault("skill_categories", fallback["skill_categories"])
        parsed.setdefault("summary", fallback["summary"])
        return parsed
    except Exception:
        return fallback
