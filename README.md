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

## Semantic retrieval (this phase)

```
prompt → query processing → EmbeddingService → cosine vs rag_chunks
      → top-K chunks → group by element_id (max score) → candidates
```

- Same embedding model for documents and queries
- Geometry stored/returned but **not** used for ranking
- No default similarity threshold
- Not yet wired into the LLM chat path

Debug in the browser console (dev):

```js
await window.__RAG_DEBUG__.debugRetrieve("Explain Gauss's law")
```

## Tests

```bash
npm test
cd backend && DATABASE_URL='...' pytest
```
