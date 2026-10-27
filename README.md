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

## Semantic retrieval + Canvas Agent

```
prompt → encode_query → cosine → ranked TextElements
      → pick semantic anchors → spatial radius → context budget
      → generation-mode system prompt → Copy LLM Prompt
      → (you) paste into ChatGPT → Paste LLM Response
      → Preview AI plan → Apply
      → validate → editor commands (one undo transaction)
```

**Default: Manual LLM Mode** (`VITE_LLM_EXECUTION_MODE=manual`) — **zero paid LLM API calls**.

### Generation format

Two generation paths share the same canonical canvas elements:

| Mode | Env / UI | LLM output | Use for |
|------|----------|------------|---------|
| **content_first** (default on this branch) | `VITE_AI_GENERATION_MODE=content_first` or RAG **Content-first** | Markdown educational prose | New standalone lessons / explanations |
| **operations** | `VITE_AI_GENERATION_MODE=operations` or RAG **JSON ops** | Structured JSON `create_*` / update ops | Editing existing elements; precise targeting |

**Operations mode** — the LLM is a planner and returns JSON only (`create_text`, `create_equation`, `create_graph`, updates, associations). Docs: `src/features/ai/agent/prompts/canvas_editor_system.md`.

**Content-first mode** — the LLM writes Markdown (`#` headings, paragraphs, nested lists, blockquotes, fenced/inline code, GFM tables, `$` / `$$` math, `:::graph`). These structures stay inside TextElement rich text (not separate canvas element types). Optional `:::json` directives support `edit` / `add_text` (above|below) against existing element IDs from context; educational content stays in the Markdown body after each JSON block. Fenced code is literal (cannot trigger `:::json` / `:::graph`).

**Visual structure templates** — design reusable layouts in the Structures panel (text / equation / graph slots + decorative elements). Assign a natural-language content description per generative slot. When that template is selected for AI generation, the LLM fills `:::structure Template Name` … `:::endstructure` blocks (slot markers match the descriptions). The app clones the template geometry/styling, fills slots, and packs multiple instances with the user’s chronological direction, max row/column limits, and optional columns:rows ratio. Docs: `src/features/ai/contentFirst/content_first_system.md` (runtime: `contentFirstPrompt.ts`; mirrored under `backend/app/agent/prompts/`).

The app owns IDs, coordinates, collision avoidance, history, and RAG reindex in both modes.

- Semantic ranking and spatial expansion are **separate** from edit-target choice
- Relative placement uses **world-space** coordinates
- Leave `RAG_MIN_SIMILARITY` unset

### RAG Debug panel (dev)

1. `npm run dev` → click **RAG** (top-right)
2. Confirm **Manual** under LLM execution
3. Choose **Generation format**: **JSON ops** or **Content-first**
4. Prompt → **Retrieve** → select anchors (Top 1/3/5)
5. Adjust spatial radius
6. **Preview context** / **Preview LLM prompt**
7. **Copy LLM prompt** → paste into ChatGPT
8. **Paste LLM response** → **Preview AI plan** → **Apply** (atomic undo)

In JSON ops mode expect an `operations` array. In content-first mode expect Markdown (fenced/inline code, blockquotes, nested lists, tables, display math, optional `:::graph` markers).

Automatic mode (`VITE_LLM_EXECUTION_MODE=automatic` or panel toggle) restores **Send with context (API)** and uses the selected generation format’s system instruction.

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
