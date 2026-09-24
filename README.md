# AI Study Tool — StudyBoard

Infinite-canvas study/note editor with a first-pass AI chat overlay.

## Stack

- React + TypeScript + Vite
- react-konva / Konva for rendering
- Zustand for canvas + AI UI state
- FastAPI backend that proxies prompts to an LLM (OpenAI by default)

## Quick start

### 1. Backend (required for AI)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env and set OPENAI_API_KEY=sk-...
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

- API key: `backend/.env` → `OPENAI_API_KEY`
- Model: `backend/.env` → `OPENAI_MODEL` (default `gpt-4o-mini`)
- Health check: `GET http://127.0.0.1:8000/health`
- Chat: `POST http://127.0.0.1:8000/api/chat` with `{ "prompt": "..." }` → `{ "text": "..." }`

The backend starts even without an API key; chat requests then return a clear configuration error.

### 2. Frontend

```bash
npm install
npm run dev
```

Open the Vite URL (usually http://localhost:5173). The floating **Ask AI** control sits at the bottom centre of the canvas.

Optional: set the backend URL in `.env.local` (gitignored):

```
VITE_AI_API_BASE_URL=http://127.0.0.1:8000
```

## Scripts

- `npm run dev` — local development server
- `npm run build` — typecheck + production build
- `npm run typecheck` — TypeScript only
- `npm run lint` — oxlint
- `npm run test` — frontend unit tests (mocked AI)
- `npm run preview` — preview production build

Backend tests:

```bash
cd backend && pytest
```

## AI feature (v1)

This phase is intentionally minimal:

1. User types a prompt in the floating bar
2. React app calls `POST /api/chat` on our backend
3. Backend calls the configured LLM via an `LLMService` abstraction
4. Plain text is shown in a floating response panel above the prompt

**Not included yet:** RAG, embeddings, board context, canvas editing, agents, conversation history, streaming.

Secrets never live in the client — only the backend URL does.

## Architecture notes

Board state is a structured `CanvasDocument` (elements + camera). Konva is a view layer only — never the source of truth. AI prompt state lives in `src/features/ai` (separate Zustand store) and does not mutate the canvas document.

```
React (Ask AI UI)
  → AiService.sendPrompt
  → POST /api/chat
  → LLMService.generate
  → OpenAIProvider
  → LLM
```
