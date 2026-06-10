# RoleRAG Interviewer

RoleRAG Interviewer is a full-stack technical screening app that combines resume parsing, role-specific retrieval, adaptive question generation, answer evaluation, and interview session traceability.

The app is designed for AI/ML and backend-style screening flows where the first question is grounded in a candidate's resume and a role-specific knowledge base, and later turns adapt based on the candidate's answers.

## What It Does

- Accepts a candidate resume in `PDF` or `TXT` format
- Extracts a structured candidate profile from the resume
- Retrieves role-specific context from a local knowledge base using ChromaDB
- Generates interview questions grounded in resume signals and retrieved content
- Evaluates candidate answers turn by turn
- Produces a final session summary after the interview ends
- Stores the full interview trace: `Context -> Question -> Answer -> Evaluation`

## Supported Roles

- `AI/ML Engineer`
- `Backend Engineer`
- `Data Science / Applied ML`

## Tech Stack

- Frontend: `React`, `Vite`, `Axios`
- Backend: `FastAPI`, `SQLAlchemy`, `Pydantic Settings`
- Vector store: `ChromaDB`
- Embeddings: local `sentence-transformers` by default, with optional OpenAI embeddings
- File parsing: `pypdf`
- Database: `SQLite`
- LLM integration: `OpenAI` with local fallbacks when no API key is provided

## Project Structure

```text
RAG Interviewer/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── models/
│   │   ├── schemas/
│   │   └── services/
│   ├── data/
│   │   ├── chroma/
│   │   ├── kb_docs/
│   │   └── uploads/
│   ├── Dockerfile
│   └── requirements.txt
├── docs/
│   └── ARCHITECTURE.md
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   └── services/
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
└── README.md
```

## How The Flow Works

1. The candidate uploads a resume and selects a target role.
2. The backend extracts resume text and builds a structured profile.
3. The RAG layer builds role-aware retrieval queries.
4. ChromaDB returns the most relevant role-specific chunks.
5. The app generates one grounded interview question.
6. The candidate submits an answer.
7. The app evaluates the answer and creates the next adaptive question.
8. After the final turn, the app builds a session summary.

## Knowledge Base Layout

Add role-specific source files under `backend/data/kb_docs/` before ingestion.

Example:

```text
backend/data/kb_docs/
├── AI_ML_Engineer/
│   └── ml_notes.pdf
├── Backend_Engineer/
│   └── backend_system_design.txt
└── Data_Science_Applied_ML/
    └── applied_ml_notes.md
```

Supported knowledge-base file types:

- `.pdf`
- `.txt`
- `.md`

## Local Setup

### 1. Backend

```bash
cd backend
python3 -m venv venv
venv/bin/python -m pip install -r requirements.txt
venv/bin/python -m uvicorn app.main:app --reload
```

The backend starts on `http://localhost:8000`.

### 2. Frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend starts on `http://localhost:5173`.

## Environment Variables

Create `backend/.env` if you want to override defaults:

```env
APP_NAME=RoleRAG Interviewer
DATABASE_URL=sqlite:///./interview.db
CHROMA_DIR=./data/chroma
UPLOAD_DIR=./data/uploads
KB_DIR=./data/kb_docs
EMBEDDING_PROVIDER=local
EMBEDDING_MODEL=all-MiniLM-L6-v2
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000
MAX_TURNS=5
```

## OpenAI Usage

Local embeddings are the default development path and do not require OpenAI credits.

When an API key is available, the app uses OpenAI for:

- richer resume profile extraction
- interview question generation
- answer evaluation
- final session summarization

If you want hosted embeddings later, set:

- `EMBEDDING_PROVIDER=openai`
- `EMBEDDING_MODEL=text-embedding-3-small`
- `OPENAI_API_KEY=...`

When no API key is present, fallback logic still exists for resume parsing, question generation, evaluation, and summary generation, and the default local RAG retrieval flow continues to work.

## Ingest The Knowledge Base

After adding files under `backend/data/kb_docs/`, run:

```bash
curl -X POST "http://localhost:8000/api/kb/ingest"
```

Or ingest one role only:

```bash
curl -X POST "http://localhost:8000/api/kb/ingest?role=AI/ML%20Engineer"
```

If ingestion fails on the first local run, make sure the machine has internet access once so the sentence-transformer model can download and cache locally.

## API Endpoints

### Health

```http
GET /health
```

### Ingest knowledge base

```http
POST /api/kb/ingest
```

### Start interview

```http
POST /api/interviews/start
```

Form fields:

- `role`
- `resume`

### Submit answer

```http
POST /api/interviews/{session_id}/answer
```

JSON body:

```json
{
  "answer": "Your answer here"
}
```

### Get session summary

```http
GET /api/interviews/{session_id}
```

### Download session PDF report

```http
GET /api/interviews/{session_id}/report.pdf
```

### Reset interview session

```http
POST /api/interviews/{session_id}/reset
```

## Docker

You can also run the full stack with Docker Compose:

```bash
docker compose up --build
```

Services:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`

## Deploy On Render

This repo includes a root-level `render.yaml` for a two-service Render setup:

- `role-rag-interviewer-api`: Docker-based FastAPI backend
- `role-rag-interviewer-frontend`: static Vite frontend

Why this setup:

- the backend needs persistent storage for `SQLite`, uploaded files, and `Chroma`
- the frontend can be served cheaply as a static site

Deployment steps:

1. Push the repo to GitHub.
2. In Render, choose `New +` -> `Blueprint`.
3. Select this repository.
4. Render will detect `render.yaml` and create both services.
5. When prompted, set `OPENAI_API_KEY` only if you want OpenAI-powered resume/question/evaluation flows.

Important deployment notes:

- the backend service is configured with a persistent disk mounted at `/app/data`
- `DATABASE_URL`, `CHROMA_DIR`, `UPLOAD_DIR`, and `KB_DIR` are pointed at that persistent storage
- local embeddings are the default deployment path, so RAG ingestion works without OpenAI credits
- after deploy, upload or copy role documents into the deployed knowledge-base folder and run:

```bash
curl -X POST "https://role-rag-interviewer-api.onrender.com/api/kb/ingest?role=AI/ML%20Engineer"
```

If you rename either Render service, update these environment variables in Render:

- backend `CORS_ORIGINS`
- frontend `VITE_API_URL`

## Why This Project Is Useful

This project is more than a prompt wrapper. It demonstrates:

- end-to-end RAG orchestration
- resume-aware personalization
- role-specific retrieval design
- adaptive interview loops
- turn-level storage and auditability
- practical full-stack integration with FastAPI and React

## Notes

- Resume uploads currently support only `PDF` and `TXT`
- The default database is local `SQLite`
- Chroma persistence is stored under `backend/data/chroma`
- Uploaded resumes are stored under `backend/data/uploads`
- The current default interview length is `5` turns

## Architecture

More implementation detail is documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
