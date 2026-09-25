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

## Semantic retrieval + manual RAG debug

```
prompt → embed → cosine → ranked TextElements
      → (debug) pick semantic anchors
      → (debug) spatial AABB radius expansion
      → context budget → preview → Send with context → LLM
```

- Semantic ranking and spatial expansion are **separate stages** (no combined score)
- Radius uses **world-space** AABB edge distance (zoom-independent)
- Radius `0` = semantic anchors only
- `RAG_MIN_SIMILARITY` still unset by default
- Normal Ask AI path is unchanged; RAG context is opt-in via the debug panel

### RAG Debug panel (dev)

1. Run the app with `npm run dev`
2. Click the **RAG** button (top-right) or `window.__RAG_DEBUG__.openPanel()`
3. Enter a prompt → **Retrieve** → check anchors (or Top 1/3/5)
4. Adjust spatial radius (slider) — highlights update live; no LLM call
5. **Preview context** → inspect elements + serialized payload
6. **Send with context** → system instruction + canvas context + user prompt → LLM → canvas TextElement

Console helpers:

```js
await window.__RAG_DEBUG__.debugRetrieve("Explain Gauss's law")
window.__RAG_DEBUG__.openPanel()
```

## Tests

```bash
npm test
cd backend && DATABASE_URL='...' pytest
```
