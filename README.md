# AI Study Tool — StudyBoard

Infinite-canvas study/note editor with AI chat, RAG text indexing, and semantic retrieval.

## Stack

- React + TypeScript + Vite + Zustand + Konva
- FastAPI + PostgreSQL (pgvector extension enabled; embeddings stored as `float[]` until model/dimension fixed)

## Quick start

```bash
# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env
# Set DATABASE_URL, and for semantic retrieval:
#   EMBEDDING_PROVIDER=deterministic   # or openai
#   EMBEDDING_MODEL=deterministic-hash-v1
# Leave RAG_MIN_SIMILARITY unset.
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Frontend
npm install && npm run dev
```

## Semantic retrieval + Manual LLM Mode

```
prompt → embed → cosine → ranked TextElements
      → pick semantic anchors → spatial radius → context budget
      → LlmPromptBuilder → Copy LLM Prompt
      → (you) paste into ChatGPT → Paste LLM Response → Apply
      → same handleLlmResponse → canvas TextElement
```

**Default: Manual LLM Mode** (`VITE_LLM_EXECUTION_MODE=manual`) — **zero paid LLM API calls**.

- Semantic ranking and spatial expansion are **separate stages**
- Radius uses **world-space** AABB edge distance
- Leave `EMBEDDING_MODEL` blank until you choose a model; use `deterministic` only for pipeline smoke tests
- Leave `RAG_MIN_SIMILARITY` unset

### RAG Debug panel (dev)

1. `npm run dev` → click **RAG** (top-right)
2. Confirm **Manual** under LLM execution
3. Prompt → **Retrieve** → select anchors (Top 1/3/5)
4. Adjust spatial radius
5. **Preview context** (retrieval) and/or **Preview LLM prompt** (full ChatGPT paste)
6. **Copy LLM prompt** → paste into ChatGPT
7. **Paste LLM response** → Apply → TextElement on canvas (undoable)

Automatic mode (`VITE_LLM_EXECUTION_MODE=automatic` or panel toggle) restores **Send with context (API)**.

```js
window.__RAG_DEBUG__.openPanel()
```

## Tests

```bash
npm test
cd backend && DATABASE_URL='...' pytest
```
