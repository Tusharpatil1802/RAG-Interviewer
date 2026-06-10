# Netlify + Supabase Migration

This document tracks the parallel backend migration from:

- `FastAPI + SQLite + Chroma + local files`

to:

- `Netlify Functions + Supabase Postgres + pgvector + Supabase Storage`

## What Is Added

- `netlify.toml` for Netlify build + function routing
- `netlify/functions/api.ts` as the new serverless API entrypoint
- `netlify/functions/_lib/*` shared TypeScript helpers
- `supabase/migrations/20260610_netlify_interview_schema.sql` for hosted data + vector schema
- `frontend/vite.config.js` so local development can keep using `/api` through a Vite proxy

## New Hosted Architecture

### Frontend

- Netlify serves the built Vite app from `frontend/dist`
- frontend calls `/api/*` on the same origin
- in local development, Vite proxies `/api` to `http://localhost:8000`

### Backend

- Netlify Functions handle all `/api/*` routes
- `api.ts` mirrors the current interview lifecycle routes:
  - `POST /api/kb/ingest`
  - `POST /api/interviews/start`
  - `POST /api/interviews/{id}/answer`
  - `GET /api/interviews/{id}`
  - `GET /api/interviews/{id}/report.pdf`
  - `POST /api/interviews/{id}/reset`

### Data

- interview sessions and turns live in Supabase Postgres
- knowledge-base chunks live in Postgres with `pgvector`
- resumes, reports, and KB source files live in Supabase Storage buckets

## Required Environment Variables

### Netlify Functions

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_RESUME_BUCKET`
- `SUPABASE_REPORT_BUCKET`
- `SUPABASE_KB_BUCKET`
- `GROQ_API_KEY`
- `GROQ_MODEL`
- `EMBEDDING_PROVIDER`
- `EMBEDDING_MODEL`
- `MAX_TURNS`

You can start from:

- [.env.netlify.example](/Users/tusharpatil/Desktop/ML%20PROJECT%20/RAG%20Interviewer/.env.netlify.example)

## Exact Supabase Bucket Setup

Create these three storage buckets in your Supabase project:

1. `resumes`
2. `reports`
3. `kb-docs`

Recommended settings:

- `resumes`: private
- `reports`: private
- `kb-docs`: private

Dashboard path:

1. Open your Supabase project.
2. Go to `Storage`.
3. Create bucket `resumes`.
4. Create bucket `reports`.
5. Create bucket `kb-docs`.

Folder layout expected by the ingestion flow inside `kb-docs`:

```text
kb-docs/
├── AI_ML_Engineer/
│   └── ml_notes.pdf
├── Backend_Engineer/
│   └── backend_notes.txt
└── Data_Science_Applied_ML/
    └── ds_notes.md
```

## Exact Supabase Database Setup

Run the migration in the Supabase SQL editor:

1. Open your Supabase project.
2. Go to `SQL Editor`.
3. Paste the contents of:
   - [supabase/migrations/20260610_netlify_interview_schema.sql](/Users/tusharpatil/Desktop/ML%20PROJECT%20/RAG%20Interviewer/supabase/migrations/20260610_netlify_interview_schema.sql)
4. Run it once.

This creates:

- `interview_sessions`
- `interview_turns`
- `kb_chunks`
- the `vector` extension
- the `match_kb_chunks(...)` retrieval function

## Local Validation Commands

Install the new root dependencies:

```bash
cd "/Users/tusharpatil/Desktop/ML PROJECT /RAG Interviewer"
npm install
```

Create your local Netlify env file:

```bash
cd "/Users/tusharpatil/Desktop/ML PROJECT /RAG Interviewer"
cp .env.netlify.example .env.netlify.local
```

Then fill in:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GROQ_API_KEY`

Type-check the new Netlify backend:

```bash
cd "/Users/tusharpatil/Desktop/ML PROJECT /RAG Interviewer"
npx tsc --noEmit
```

Validate the frontend build:

```bash
cd "/Users/tusharpatil/Desktop/ML PROJECT /RAG Interviewer/frontend"
npm run build
```

Run the current local app with the existing Python backend and new same-origin frontend wiring:

Backend terminal:

```bash
cd "/Users/tusharpatil/Desktop/ML PROJECT /RAG Interviewer/backend"
source venv/bin/activate
python -m uvicorn app.main:app --reload
```

Frontend terminal:

```bash
cd "/Users/tusharpatil/Desktop/ML PROJECT /RAG Interviewer/frontend"
npm run dev
```

Because the frontend now uses `/api`, Vite will proxy those requests to `http://localhost:8000`.

## Hosted Validation Commands

Once the Supabase buckets contain KB files under the expected folder names, validate ingestion through the Netlify-style API route:

```bash
curl -X POST "http://localhost:8000/api/kb/ingest?role=AI/ML%20Engineer"
```

For the future Netlify deployment path, the equivalent route will still be:

```bash
curl -X POST "https://YOUR_NETLIFY_SITE.netlify.app/api/kb/ingest?role=AI/ML%20Engineer"
```

## Hosted AI Configuration

The hosted Netlify backend uses:

- Groq for resume extraction, question generation, answer evaluation, and summaries
- deterministic 1536-dimensional hash embeddings for Supabase `pgvector` retrieval

Recommended Netlify values:

```env
GROQ_API_KEY=your_groq_key
GROQ_MODEL=llama-3.1-8b-instant
EMBEDDING_PROVIDER=hash
EMBEDDING_MODEL=hash-embedding-1536
```

The old Python backend still supports the current local setup with local sentence-transformer embeddings.

## Next Migration Steps

1. Add the Netlify environment variables.
2. Redeploy the site.
3. Run `/api/kb/ingest?role=AI/ML%20Engineer`.
4. Test the interview flow and PDF report.
