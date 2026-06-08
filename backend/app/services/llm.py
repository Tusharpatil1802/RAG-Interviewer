from __future__ import annotations
import json
from openai import OpenAI
from app.core.config import get_settings

settings = get_settings()
_CLIENT = OpenAI(api_key=settings.openai_api_key) if settings.openai_api_key else None

def client_or_none():
    return _CLIENT

def safe_json_loads(raw: str, fallback: dict) -> dict:
    try:
        return json.loads(raw)
    except Exception:
        start, end = raw.find("{"), raw.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(raw[start:end + 1])
            except Exception:
                return fallback
        return fallback


def _experience_label(resume_profile: dict) -> str:
    years = resume_profile.get("years_experience")
    seniority = resume_profile.get("seniority_signal")
    if years:
        return f"{years} years of experience"
    if seniority and seniority != "unknown":
        return seniority
    return "Fresher / Entry-level"


def _context_snippets(retrieved_context: list[dict]) -> str:
    if not retrieved_context:
        return "No retrieved knowledge base context was available."
    snippets = []
    for item in retrieved_context[:3]:
        meta = item.get("metadata", {})
        source = meta.get("source", "knowledge base")
        text = " ".join((item.get("text") or "").split())
        if text:
            snippets.append(f"Source: {source}\n{text[:420]}")
        else:
            snippets.append(f"Source: {source}")
    return "\n\n".join(snippets)


def _answer_focus(last_answer: str | None, skills: list[str]) -> str | None:
    if not last_answer:
        return None
    lowered = last_answer.lower()
    for skill in skills:
        if skill.lower() in lowered:
            return skill
    for keyword in ["latency", "accuracy", "deployment", "monitoring", "testing", "debugging", "scaling"]:
        if keyword in lowered:
            return keyword
    return None


ROLE_KEYWORDS = {
    "AI/ML Engineer": [
        "rag", "llm", "machine learning", "xgboost", "random forest", "forecasting",
        "churn", "classification", "regression", "evaluation", "langchain", "chroma", "vector"
    ],
    "Backend Engineer": [
        "fastapi", "api", "backend", "mongodb", "django", "rest", "async", "pydantic",
        "service", "database", "validation", "deployment"
    ],
    "Data Science / Applied ML": [
        "eda", "analytics", "power bi", "sql", "pandas", "numpy", "forecasting",
        "churn", "model validation", "visualization", "statistical", "feature engineering"
    ],
}


def _profile_brief(resume_profile: dict) -> str:
    project_titles = [item.get("title") for item in resume_profile.get("project_details", []) if item.get("title")]
    highlights = resume_profile.get("experience_highlights", [])[:4]
    parts = []
    if resume_profile.get("summary"):
        parts.append(f"Resume summary: {resume_profile['summary']}")
    if project_titles:
        parts.append(f"Project titles: {', '.join(project_titles[:4])}")
    if highlights:
        parts.append(f"Experience highlights: {' | '.join(highlights)}")
    return "\n".join(parts) if parts else "No additional resume highlights were available."


def _select_relevant_project(role: str, resume_profile: dict, last_answer: str | None = None) -> dict | None:
    projects = resume_profile.get("project_details", [])
    if not projects:
        return None

    keywords = ROLE_KEYWORDS.get(role, [])
    last_answer_lower = (last_answer or "").lower()
    best_project = None
    best_score = -1
    for project in projects:
        title_text = project.get("title", "").lower()
        haystack = f"{title_text} {' '.join(project.get('bullets', []))}".lower()
        score = sum(5 for keyword in keywords if keyword in title_text)
        score += sum(2 for keyword in keywords if keyword in haystack)
        score += sum(1 for skill in resume_profile.get("skills", [])[:8] if skill.lower() in haystack)
        if last_answer_lower and last_answer_lower[:120] in haystack:
            score += 3
        if last_answer_lower and any(token in haystack for token in last_answer_lower.split()[:10]):
            score += 1
        if score > best_score:
            best_score = score
            best_project = project
    return best_project or projects[0]


def _project_focus(project: dict | None, resume_profile: dict, role: str, last_answer: str | None) -> str:
    if project:
        project_text = f"{project.get('title', '')} {' '.join(project.get('bullets', []))}".lower()
        for keyword in ROLE_KEYWORDS.get(role, []):
            if keyword in project_text:
                return keyword
        for skill in resume_profile.get("skills", []):
            if skill.lower() in project_text:
                return skill
    return _answer_focus(last_answer, resume_profile.get("skills", [])) or (resume_profile.get("skills", [])[:1] or ["machine learning"])[0]


def _fallback_question(
    role: str,
    resume_profile: dict,
    previous_questions: list[str],
    turn_number: int,
    last_answer: str | None,
    retrieved_context: list[dict],
) -> str:
    skills = resume_profile.get("skills", [])
    projects = resume_profile.get("projects", [])
    skill = skills[min(turn_number - 1, len(skills) - 1)] if skills else "machine learning"
    relevant_project = _select_relevant_project(role, resume_profile, last_answer)
    project_title = relevant_project.get("title") if relevant_project else None
    project = project_title or (projects[min(turn_number - 1, len(projects) - 1)] if projects else "one of your projects")
    project_bullets = relevant_project.get("bullets", []) if relevant_project else []
    focus = _project_focus(relevant_project, resume_profile, role, last_answer) or skill
    source = None
    if retrieved_context:
        source = retrieved_context[0].get("metadata", {}).get("source")

    role_specific_candidates = {
        "AI/ML Engineer": [
            f"In your {project}, how did you make sure the system stayed grounded and did not hallucinate while using {focus}?",
            f"For {project}, what retrieval, chunking, feature-engineering, or modeling trade-off had the biggest impact on result quality, and why?",
            f"If quality dropped in {project} after a new data or prompt change, how would you debug whether the issue came from data, retrieval, prompts, or the model itself?",
            f"What evaluation signals or offline tests would you track for {project} before trusting it in production?",
        ],
        "Backend Engineer": [
            f"In your {project}, how did you structure the backend or APIs so the system stayed reliable as requests and data complexity increased?",
            f"If the backend for {project} started failing under load, what would you inspect first across validation, async flow, database access, and external calls?",
            f"What trade-offs did you make in {project} between clean API design, latency, data consistency, and maintainability?",
            f"What monitoring, logging, or failure-handling would you add to make {project} production ready?",
        ],
        "Data Science / Applied ML": [
            f"In your {project}, which data-cleaning, feature-engineering, or validation step most improved the final result, and how did you know?",
            f"If model quality in {project} suddenly dropped on new data, how would you separate a data-quality issue from a modeling issue?",
            f"What trade-offs did you make in {project} between interpretability, model performance, and operational simplicity?",
            f"What metrics would you track for {project} to know whether the model is genuinely useful in a business setting?",
        ],
    }

    candidates = []
    if relevant_project:
        if role == "AI/ML Engineer":
            candidates.append(
                f"In your {project}, what was the hardest technical decision you made around {focus}, and how did it affect quality or reliability?"
            )
        elif role == "Backend Engineer":
            candidates.append(
                f"In your {project}, what was the hardest backend decision you made around APIs, async flow, or data handling, and why?"
            )
        elif role == "Data Science / Applied ML":
            candidates.append(
                f"In your {project}, what was the hardest decision you made around feature engineering, validation, or model choice, and how did you justify it?"
            )
        else:
            first_bullet = project_bullets[0] if project_bullets else ""
            candidates.append(
                f"Your resume mentions {project}. Based on the work where you {first_bullet[:110].lower() if first_bullet else 'applied it'}, what was the hardest technical decision you made?"
            )
    else:
        candidates.append(
            f"Your resume mentions {skill}. Can you walk me through {project} and explain the hardest technical decision you made while using {skill}?"
        )

    candidates.extend(role_specific_candidates.get(role, []))
    candidates.extend([
        f"Suppose a feature built with {focus} works in development but becomes unreliable in production. How would you debug it step by step?",
        f"What signals, tests, or monitoring would you add to catch failures early in a system that depends on {focus}?",
        f"If this system started giving weak results after a new release, how would you isolate whether the issue came from data, code, infrastructure, or model behavior?"
    ])

    if source:
        candidates.append(
            f"The current interview context came from {source}. Which idea from that material connects most closely to your experience with {focus}, and how would you apply it in practice?"
        )

    used = {question.strip().lower() for question in previous_questions if question}
    start_index = min(max(turn_number - 1, 0), len(candidates) - 1)
    ordered_candidates = candidates[start_index:] + candidates[:start_index]
    for candidate in ordered_candidates:
        if candidate.strip().lower() not in used:
            return candidate
    return f"Let us go deeper on {focus}. Describe a real failure mode you would expect, how you would detect it, and how you would fix it."


def generate_question(
    role: str,
    resume_profile: dict,
    retrieved_context: list[dict],
    previous_questions=None,
    turn_number: int = 1,
    last_answer: str | None = None,
) -> str:
    previous_questions = previous_questions or []

    skills = resume_profile.get("skills", [])
    projects = resume_profile.get("projects", [])
    experience = _experience_label(resume_profile)
    context_block = _context_snippets(retrieved_context)

    prompt = f"""
You are a senior technical interviewer.

Generate exactly ONE interview question for this candidate.

Candidate role:
{role}

Candidate experience level:
{experience}

Candidate resume skills:
{skills}

Candidate projects:
{projects}

Resume highlights:
{_profile_brief(resume_profile)[:1800]}

Retrieved knowledge base context:
{context_block[:1800]}

Previous questions already asked:
{previous_questions}

Candidate's latest answer:
{last_answer or "No answer yet."}

Current turn number:
{turn_number}

Rules:
1. The question MUST explicitly mention at least one resume skill or project.
2. The question MUST match the candidate experience level.
3. Do NOT ask a generic question.
4. Do NOT repeat previous questions.
5. Ask a practical design/debugging/scenario-based question.
6. Keep the question under 70 words.
7. For early turns, ask about experience/project background.
8. For later turns, ask deeper debugging, deployment, or trade-off questions.

Return only the question.
"""

    try:
        if not _CLIENT:
            raise RuntimeError("OpenAI client unavailable")
        response = _CLIENT.chat.completions.create(
            model=settings.openai_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.75,
        )
        return response.choices[0].message.content.strip()
    except Exception:
        return _fallback_question(role, resume_profile, previous_questions, turn_number, last_answer, retrieved_context)


def _fallback_evaluation(answer: str, context: list[dict]) -> dict:
    lowered = answer.lower()
    words = len(answer.split())
    score = 2
    strengths = []
    gaps = []

    if words >= 35:
        score += 2
        strengths.append("Gave a reasonably detailed explanation instead of a one-line answer.")
    else:
        gaps.append("Add more implementation detail so the interviewer can judge depth.")

    if any(phrase in lowered for phrase in ["for example", "for instance", "i used", "we used", "in my project", "in production"]):
        score += 2
        strengths.append("Grounded the answer in a concrete example or project.")
    else:
        gaps.append("Tie the answer to a real project, example, or incident.")

    if any(phrase in lowered for phrase in ["trade-off", "tradeoff", "latency", "accuracy", "cost", "performance", "scalability", "maintainability"]):
        score += 2
        strengths.append("Discussed trade-offs or production constraints.")
    else:
        gaps.append("Call out trade-offs such as latency, accuracy, cost, or maintainability.")

    if any(phrase in lowered for phrase in ["debug", "log", "metric", "monitor", "test", "rollback", "failure", "alert"]):
        score += 2
        strengths.append("Included a practical debugging, testing, or monitoring angle.")
    else:
        gaps.append("Explain how you would test, monitor, or debug the solution.")

    if context:
        score += 1
        strengths.append("The answer can be reviewed against retrieved interview context.")

    score = max(2, min(10, score))
    follow_up = "Ask for one concrete failure mode and the exact signals they would inspect first."
    if gaps:
        if "real project" in gaps[0].lower():
            follow_up = "Ask them to anchor the answer in one project from their resume."
        elif "trade-offs" in " ".join(gaps).lower():
            follow_up = "Ask which trade-off they would prioritize first and why."
        elif "test, monitor, or debug" in " ".join(gaps).lower():
            follow_up = "Ask for the first logs, metrics, or tests they would check."

    return {
        "score": score,
        "strengths": strengths or ["Answer captured and tied to the current interview turn."],
        "gaps": gaps or ["Add a little more specificity to show implementation depth."],
        "follow_up": follow_up,
        "grounded_notes": _context_snippets(context)[:300],
    }

def evaluate_answer(question: str, answer: str, context: list[dict]) -> dict:
    ctx = "\n".join(c["text"][:600] for c in context)
    if not _CLIENT:
        return _fallback_evaluation(answer, context)
    prompt = f"""Evaluate the candidate answer as JSON with keys score, strengths, gaps, follow_up.
Question: {question}
Answer: {answer}
Reference context: {ctx}
Score out of 10. Be concise, fair, and specific. Strengths and gaps must be arrays of strings."""
    try:
        resp = _CLIENT.chat.completions.create(model=settings.openai_model, messages=[{"role":"user","content":prompt}], temperature=0.2, response_format={"type":"json_object"})
        return safe_json_loads(resp.choices[0].message.content, {"score": 5, "strengths": ["Submitted answer"], "gaps": ["Evaluator output could not be parsed"]})
    except Exception:
        return {"score": 5, "strengths": ["Submitted answer"], "gaps": ["LLM evaluator failed; retry with a valid API key"]}

def summarize_session(role: str, profile: dict, turns: list) -> str:
    completed = [t for t in turns if t.answer]
    if not completed:
        return "No interview turns were completed."

    scores = [t.evaluation.get("score") for t in completed if t.evaluation and isinstance(t.evaluation.get("score"), (int, float))]
    average = round(sum(scores) / len(scores), 1) if scores else None
    transcript = [
        {
            "question": t.question,
            "answer": t.answer,
            "evaluation": t.evaluation,
            "sources": [c.get("metadata", {}).get("source") for c in (t.retrieved_context or [])]
        }
        for t in completed
    ]

    if not _CLIENT:
        strengths = []
        gaps = []
        for t in completed:
            ev = t.evaluation or {}
            strengths.extend(ev.get("strengths", [])[:2])
            gaps.extend(ev.get("gaps", [])[:2])
        return "\n".join([
            f"Interview summary for {profile.get('name') or 'candidate'} targeting {role}.",
            f"Completed turns: {len(completed)} / {settings.max_turns}.",
            f"Average score: {average}/10." if average is not None else "Average score: unavailable.",
            "Strength signals: " + ("; ".join(dict.fromkeys(strengths)) or "answers were recorded for each completed turn."),
            "Improvement areas: " + ("; ".join(dict.fromkeys(gaps)) or "add more evidence, trade-offs, and implementation details."),
            "Hiring recommendation: needs human review; enable OPENAI_API_KEY for a deeper narrative recommendation."
        ])

    prompt = f"""Write a genuine final interview summary for a role-based RAG screening system.
Role: {role}
Candidate profile: {json.dumps(profile)}
Average score: {average}
Transcript and per-turn evaluations: {json.dumps(transcript)}

Return a concise narrative with these headings:
1. Overall signal
2. Strengths
3. Gaps / risks
4. Suggested follow-up
5. Hiring recommendation
Base every claim on the transcript and evaluations. Do not invent credentials."""
    try:
        resp = _CLIENT.chat.completions.create(model=settings.openai_model, messages=[{"role":"user","content":prompt}], temperature=0.25)
        return resp.choices[0].message.content.strip()
    except Exception:
        return f"Interview completed for {profile.get('name') or 'candidate'} targeting {role}. Average score: {average}/10. Review per-turn strengths and gaps for the hiring decision."
