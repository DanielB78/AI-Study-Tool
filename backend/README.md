# AI Study Tool — Backend

FastAPI service: LLM chat proxy + RAG text indexing + semantic retrieval.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

### EmbeddingGemma Setup

1. Create / log into a [Hugging Face](https://huggingface.co/) account.
2. Open [`google/embeddinggemma-300m`](https://huggingface.co/google/embeddinggemma-300m).
3. Accept Google's Gemma model usage terms (gated model).
4. Create a Hugging Face access token (read is enough).
5. Set `HF_TOKEN=…` in `backend/.env` (or `HUGGINGFACE_HUB_TOKEN`).
6. Install backend dependencies (`pip install -r requirements.txt`).
7. Apply migrations (`alembic upgrade head`) — includes `vector(768)`.
8. Start the backend.
9. Check `GET /api/rag/embedding/status` and optionally `POST /api/rag/embedding/smoke`.
10. Reindex existing boards: `POST /api/rag/boards/{board_id}/embeddings/rebuild`.

Do **not** commit real tokens. The first request downloads and caches the model via the normal Hugging Face cache.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres URL |
| `EMBEDDING_PROVIDER` | `sentence_transformers` (recommended), `openai`, or `deterministic` |
| `EMBEDDING_MODEL` | e.g. `google/embeddinggemma-300m` — **required, no default** |
| `EMBEDDING_DIMENSION` | `768` for EmbeddingGemma (required for ST provider) |
| `EMBEDDING_SIMILARITY` | `cosine` (higher score = more similar) |
| `EMBEDDING_DEVICE` | Optional: `cpu` / `cuda` / `mps` (empty = auto; CPU works) |
| `EMBEDDING_BATCH_SIZE` | Document batch size (default `32`) |
| `HF_TOKEN` | Hugging Face token for gated EmbeddingGemma |
| `RAG_CHUNK_TOP_K` | Top-K chunk hits (default `20`) |
| `RAG_MIN_SIMILARITY` | **Leave unset** until empirically chosen |
| `QUERY_LONG_PROMPT_THRESHOLD_WORDS` | Default `200` |
| `QUERY_TARGET_CHUNK_WORDS` | Default `125` |
| `QUERY_CHUNK_OVERLAP_WORDS` | Default `20` |

Example `.env` embedding block:

```env
EMBEDDING_PROVIDER=sentence_transformers
EMBEDDING_MODEL=google/embeddinggemma-300m
EMBEDDING_DIMENSION=768
EMBEDDING_SIMILARITY=cosine
HF_TOKEN=
# RAG_MIN_SIMILARITY=
```

## Migrations

```bash
export DATABASE_URL='postgresql+psycopg://...'
alembic upgrade head
```

- `0002_rag_embeddings` — enables pgvector + nullable embedding columns (`float[]`)
- `0003_embedding_vector_768` — converts `embedding` to `vector(768)` for EmbeddingGemma

## Run

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Semantic retrieval

```bash
# Status (never returns HF_TOKEN)
curl http://127.0.0.1:8000/api/rag/embedding/status

# Ranking smoke test (encode_query vs encode_document)
curl -X POST http://127.0.0.1:8000/api/rag/embedding/smoke

# Index (embeds documents via encode_document when EMBEDDING_* configured)
curl -X PUT http://127.0.0.1:8000/api/rag/elements/text -H 'Content-Type: application/json' -d '{...}'

# Rebuild embeddings after model change / NULL embeddings
curl -X POST http://127.0.0.1:8000/api/rag/boards/{board_id}/embeddings/rebuild

# Retrieve (cosine similarity only — no spatial scoring)
curl -X POST http://127.0.0.1:8000/api/rag/retrieve -H 'Content-Type: application/json' -d '{
  "board_id": "...",
  "prompt": "Explain Gauss'\''s law"
}'
```

Higher score = more similar. `min_similarity` defaults to `null` (top-K only).

Moving / resizing a textbox updates geometry only — it does **not** re-embed.

## Chat with optional RAG context

```bash
curl -X POST http://127.0.0.1:8000/api/chat -H 'Content-Type: application/json' -d '{
  "prompt": "Explain Gauss'\''s law",
  "system_instruction": "You are an AI assistant inside a study canvas...",
  "canvas_context": "CANVAS CONTEXT\n..."
}'
```

When `canvas_context` is set and `system_instruction` is omitted, the backend applies a default study-canvas system instruction. Plain `{ "prompt": "..." }` requests remain unchanged.

## Tests

```bash
# Unit tests — fake/deterministic embedders only (no model download)
DATABASE_URL='...' pytest

# Optional real EmbeddingGemma integration (requires HF_TOKEN + download)
RUN_EMBEDDINGGEMMA_TESTS=1 HF_TOKEN=… pytest -m embeddinggemma
```
