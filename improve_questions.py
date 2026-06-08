from pathlib import Path

base = Path.cwd()

# 1) Improve resume parser
resume_file = base / "backend/app/services/resume.py"
text = resume_file.read_text()

text = text.replace(
'''def parse_resume(text: str) -> dict:
    lower = text.lower()
    skills = []
    skill_bank = [
        "python", "fastapi", "flask", "django", "sql", "postgresql",
        "machine learning", "deep learning", "computer vision", "nlp",
        "pytorch", "tensorflow", "docker", "react", "next.js"
    ]
    for skill in skill_bank:
        if skill in lower:
            skills.append(skill)

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    name = lines[0] if lines else "Candidate"

    return {
        "name": name,
        "skills": skills,
        "summary": text[:1200]
    }
''',
'''def parse_resume(text: str) -> dict:
    lower = text.lower()

    skill_bank = [
        "python", "fastapi", "flask", "django", "sql", "postgresql",
        "machine learning", "deep learning", "computer vision", "nlp",
        "pytorch", "tensorflow", "keras", "opencv", "yolo", "cnn",
        "docker", "react", "next.js", "api", "backend", "classification",
        "object detection", "data science", "pandas", "numpy", "scikit-learn"
    ]

    skills = []
    for skill in skill_bank:
        if skill in lower:
            skills.append(skill.title())

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    name = "Candidate"
    for line in lines[:8]:
        if len(line.split()) <= 5 and not any(x in line.lower() for x in ["email", "phone", "linkedin", "github", "@"]):
            name = line
            break

    exp = "Fresher / Entry-level"
    import re
    match = re.search(r"(\\d+)\\+?\\s*(years|year|yrs|yr)", lower)
    if match:
        exp = match.group(0)

    projects = []
    project_keywords = ["project", "system", "detection", "prediction", "classification", "recognition", "chatbot", "dashboard"]
    for line in lines:
        if any(k in line.lower() for k in project_keywords) and len(line) < 160:
            projects.append(line)
        if len(projects) >= 5:
            break

    return {
        "name": name,
        "experience": exp,
        "skills": skills,
        "projects": projects,
        "summary": text[:1800]
    }
'''
)

resume_file.write_text(text)


# 2) Improve LLM question generation
llm_file = base / "backend/app/services/llm.py"
text = llm_file.read_text()

start = text.find("def generate_question")
end = text.find("\ndef evaluate_answer", start)

if start != -1 and end != -1:
    new_func = r'''
def generate_question(role: str, resume_profile: dict, retrieved_context: str, previous_questions=None, turn_number: int = 1) -> str:
    previous_questions = previous_questions or []

    skills = resume_profile.get("skills", [])
    projects = resume_profile.get("projects", [])
    experience = resume_profile.get("experience", "Fresher / Entry-level")

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

Retrieved knowledge base concept:
{retrieved_context[:1800]}

Previous questions already asked:
{previous_questions}

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
        response = client.chat.completions.create(
            model=settings.openai_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.75,
        )
        return response.choices[0].message.content.strip()
    except Exception:
        primary_skill = skills[0] if skills else "machine learning"
        project = projects[0] if projects else "one of your projects"

        fallback_questions = [
            f"Your resume mentions {primary_skill}. Can you briefly explain your experience with it and describe {project} where you applied it?",
            f"Based on your experience with {primary_skill}, describe a practical debugging issue you faced or might face in a real AI/ML system.",
            f"How would you design a production-ready system using {primary_skill}, and what trade-offs would you consider for accuracy, latency, and maintainability?",
            f"You mentioned {', '.join(skills[:3])}. How would you combine these skills to deploy an end-to-end AI/ML application?",
            f"Suppose a model related to {primary_skill} works well in testing but fails in production. How would you debug and improve it?"
        ]

        idx = min(turn_number - 1, len(fallback_questions) - 1)
        return fallback_questions[idx]
'''
    text = text[:start] + new_func + text[end:]

llm_file.write_text(text)


# 3) Make query builder more resume-specific if file exists
query_file = base / "backend/app/services/rag.py"
if query_file.exists():
    text = query_file.read_text()
    if "def build_queries" in text:
        start = text.find("def build_queries")
        end_candidates = [
            text.find("\ndef ", start + 1),
            text.find("\nclass ", start + 1)
        ]
        end_candidates = [x for x in end_candidates if x != -1]
        end = min(end_candidates) if end_candidates else len(text)

        new_func = r'''
def build_queries(role: str, resume_profile: dict, last_answer: str | None = None) -> list[str]:
    skills = resume_profile.get("skills", [])
    projects = resume_profile.get("projects", [])
    experience = resume_profile.get("experience", "Fresher / Entry-level")

    queries = []

    if skills:
        queries.append(f"{role} interview concepts for {', '.join(skills[:5])}")
        queries.append(f"practical debugging and design scenarios using {', '.join(skills[:4])}")

    if projects:
        queries.append(f"machine learning concepts related to candidate project: {projects[0]}")

    queries.append(f"{role} {experience} conceptual applied machine learning interview topics")

    if last_answer:
        queries.append(f"follow up question based on candidate answer: {last_answer[:300]}")

    return queries
'''
        text = text[:start] + new_func + text[end:]
        query_file.write_text(text)

print("✅ Patch applied successfully.")
print("Now restart backend and frontend.")
