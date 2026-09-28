# AI Study Tool — StudyBoard

Infinite-canvas study/note editor with AI chat, RAG text indexing, and semantic retrieval.

## Stack

- React + TypeScript + Vite + Zustand + Konva
- FastAPI + PostgreSQL + pgvector (`vector(768)` for EmbeddingGemma)

## Quick start

```bash
# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env
# Set DATABASE_URL and EmbeddingGemma:
#   EMBEDDING_PROVIDER=sentence_transformers
#   EMBEDDING_MODEL=google/embeddinggemma-300m
#   EMBEDDING_DIMENSION=768
#   EMBEDDING_SIMILARITY=cosine
#   HF_TOKEN=<your Hugging Face token after accepting Gemma terms>
# Leave RAG_MIN_SIMILARITY unset.
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Frontend
npm install && npm run dev
```

### EmbeddingGemma (local SentenceTransformers)

1. Accept terms on [`google/embeddinggemma-300m`](https://huggingface.co/google/embeddinggemma-300m)
2. Set `HF_TOKEN` in `backend/.env`
3. First request downloads/caches the model (CPU works; optional CUDA/MPS)
4. `GET /api/rag/embedding/status` · `POST /api/rag/embedding/smoke`
5. Rebuild existing chunks: `POST /api/rag/boards/{id}/embeddings/rebuild`

Queries use `encode_query`; textbox chunks use `encode_document`. See `backend/README.md`.

## Semantic retrieval + Canvas Agent (structured ops)

```
prompt → encode_query → cosine → ranked TextElements
      → pick semantic anchors → spatial radius → context budget
      → Canvas Editor Agent prompt + JSON schema → Copy LLM Prompt
      → (you) paste into ChatGPT → Paste LLM Response
      → Preview AI plan → Apply
      → validate operations → editor commands (one undo transaction)
```

**Default: Manual LLM Mode** (`VITE_LLM_EXECUTION_MODE=manual`) — **zero paid LLM API calls**.

The LLM is a **planner**. It returns JSON operations only:

- `create_text` — new TextElement (`viewport_default` | `relative_to_element` | `absolute`)
- `update_text` — full-text replace of an existing TextElement by ID from context

The app owns IDs, coordinates, collision avoidance, history, and RAG reindex.

- Semantic ranking and spatial expansion are **separate** from edit-target choice
- Relative placement uses **world-space** coordinates
- Leave `RAG_MIN_SIMILARITY` unset

Agent docs: `src/features/ai/agent/prompts/canvas_editor_system.md` (mirrored under `backend/app/agent/prompts/`).

### RAG Debug panel (dev)

1. `npm run dev` → click **RAG** (top-right)
2. Confirm **Manual** under LLM execution
3. Prompt → **Retrieve** → select anchors (Top 1/3/5)
4. Adjust spatial radius
5. **Preview context** / **Preview LLM prompt**
6. **Copy LLM prompt** → paste into ChatGPT (expect JSON `operations` only)
7. **Paste LLM response** → **Preview AI plan** → **Apply** (atomic undo)

Automatic mode (`VITE_LLM_EXECUTION_MODE=automatic` or panel toggle) restores **Send with context (API)** and still expects structured JSON.

```js
window.__RAG_DEBUG__.openPanel()
```

## Tests

```bash
npm test
cd backend && DATABASE_URL='...' pytest
# Optional real model:
# RUN_EMBEDDINGGEMMA_TESTS=1 HF_TOKEN=… pytest -m embeddinggemma
```
