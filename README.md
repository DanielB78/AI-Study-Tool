# AI Study Tool — StudyBoard

Infinite-canvas study/note editor with AI chat + RAG text indexing foundation.

## Stack

- React + TypeScript + Vite
- react-konva / Konva for rendering
- Zustand for canvas + AI UI state
- FastAPI backend (LLM proxy + PostgreSQL RAG chunk index)
- PostgreSQL / Alembic (Supabase-compatible `DATABASE_URL`)

## Quick start

### 1. Database

```bash
# Example local Postgres
createuser -s studyboard   # or use your own role
createdb -O studyboard studyboard
```

### 2. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Set DATABASE_URL=postgresql+psycopg://studyboard:studyboard@127.0.0.1:5432/studyboard
# Set OPENAI_API_KEY=... or LLM_PROVIDER=mock
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 3. Frontend

```bash
npm install
npm run dev
```

Optional: `VITE_AI_API_BASE_URL=http://127.0.0.1:8000`

## RAG indexing (this phase)

Text elements are indexed into `rag_chunks` (no embeddings yet):

- ≤100 words → 1 chunk
- >100 words → ~75-word chunks with ~15-word overlap (paragraph → sentence → word)
- Text edits re-chunk; move/resize only updates geometry via `content_hash`
- Deletes remove chunks; undo/redo schedules a board reconcile

Inspect chunks:

```bash
curl http://127.0.0.1:8000/api/rag/boards/<board_id>/chunks
```

## Scripts

- `npm run dev` / `build` / `typecheck` / `lint` / `test`
- `cd backend && pytest`

## Architecture notes

`CanvasDocument` remains the source of truth (now with stable `id` for board identity). `rag_chunks` is a derived index. AI replies still insert normal `TextElement`s via `addElement`.
