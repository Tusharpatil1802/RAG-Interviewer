# Architecture Notes

## System intent

InterviewIQ is built as a complete interview lifecycle service rather than a single prompt script. The user journey is intentionally staged: candidate entry, resume/profile extraction, RAG retrieval, question generation, answer capture, answer evaluation, adaptive follow-up, and final summary.

## Components

- `api/interview.py`: HTTP lifecycle endpoints, validation, request/response schemas, session orchestration.
- `services/resume.py`: PDF/TXT text extraction and LLM-first structured resume profile extraction with deterministic fallback.
- `services/rag.py`: role collection mapping, ingestion, chunking, embeddings, retrieval, dynamic query construction, deduplication.
- `services/llm.py`: LLM-backed question generation, answer evaluation, and final narrative summary with offline fallbacks.
- `models/db.py`: SQLAlchemy persistence schema for sessions and turn-level traceability.
- `frontend/src/components/*`: staged React UI components for entry, stepper, question, turn log, evaluation cards, and summary view.

## Data model

`InterviewSession` stores role, resume text, extracted profile, candidate name, final summary, and creation timestamp.

`InterviewTurn` stores the generated question, candidate answer, retrieved context text/metadata, evaluation output, and timestamp. This preserves the required `Context -> Question -> Answer -> Storage` trace.

## Request flow

1. Candidate uploads a resume and selects a target role.
2. Backend extracts text and builds a structured profile.
3. Backend builds role/profile-aware retrieval queries.
4. Chroma retrieves role-specific chunks.
5. LLM generates one grounded interview question.
6. Candidate answers in the UI.
7. Backend stores answer, evaluates it, and either generates an adaptive follow-up or finalizes the summary.
8. UI shows progress, score trend, turn log, evaluation cards, and final narrative summary.

## RAG pipeline

1. Load PDFs/TXT/MD from role folders.
2. Extract text.
3. Chunk into ~950-word chunks with 160-word overlap.
4. Embed chunks using a configurable provider/model setting. Local sentence-transformer embeddings are the development default, and OpenAI embeddings remain optional.
5. Upsert chunks into persistent Chroma collections.
6. At interview time, build queries from role + resume profile + optional previous answer.
7. Retrieve top chunks, deduplicate by source/chunk, and pass them into the question generator.

## Why 950-word chunks with 160-word overlap?

The assignment-provided sources are textbook-style PDFs. Concepts often span definitions, equations/intuitions, examples, and caveats across several paragraphs. Very small chunks lose conceptual continuity and produce generic questions; very large chunks dilute retrieval precision and consume prompt budget. A 950-word chunk keeps enough textbook context for grounded question generation, while 160-word overlap reduces the risk of splitting a definition from its example or assumptions.

## Why role-specific collections instead of one collection with metadata filters?

The interview starts from an explicit role choice. Separate collections keep retrieval focused and reduce accidental cross-role contamination, especially when documents share terms like "model", "architecture", or "database". This also makes it easy to refresh or replace one role's knowledge base independently. In a larger production system, a single collection with strict metadata filtering could work, but per-role collections are simpler, auditable, and aligned with this assignment's role-specific knowledge-base requirement.

## Why local embeddings by default?

The project defaults to a local sentence-transformer model so development and demos can run without paid API credits. OpenAI embeddings remain supported through configuration for teams that want hosted embeddings in deployment.

## Why LLM-first resume extraction?

Simple keyword extraction misses project context, seniority signals, and nuanced domains. The LLM extractor returns a structured JSON profile with skills, domains, projects, and experience signals. A deterministic regex/keyword fallback remains available so the system still runs without an API key.

## Why LLM-generated final summaries?

The final summary should reflect the candidate's actual answers and evaluations, not a static template. The summary service passes the full completed turn transcript and evaluation payloads to the LLM and asks for strengths, gaps, follow-ups, and recommendation. Without an API key, the fallback still computes score and aggregates recorded strengths/gaps transparently.

## Backend design choices

- Pydantic schemas are used on request and response models so FastAPI validation and OpenAPI docs are useful.
- `MAX_TURNS` is configurable instead of buried in endpoint logic.
- Chroma client remains a module-level singleton, but embedding initialization is lazy so import-time startup does not trigger model downloads.
- Reset endpoint is included to support demo retries without creating a new session.
- Error responses are explicit for invalid file types, short extracted text, missing sessions, short answers, and missing pending questions.

## Production considerations

- Replace SQLite with PostgreSQL.
- Add background ingestion jobs for large PDFs.
- Add document versioning and stale embedding invalidation.
- Add retrieval observability: hit rate, score distance, selected sources, prompt token usage.
- Add admin-maintained role rubrics.
- Add authentication and candidate/admin dashboards.
- Add downloadable PDF reports.
