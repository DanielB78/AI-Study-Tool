# AI Study Tool — Backend

FastAPI service: LLM chat proxy + RAG text indexing + semantic retrieval.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres URL |
| `EMBEDDING_PROVIDER` | `openai` or `deterministic` (dev) — **required for retrieve** |
| `EMBEDDING_MODEL` | Model id — **required, no default** |
| `EMBEDDING_DIMENSION` | Optional; deterministic provider / future `vector(N)` only |
| `RAG_CHUNK_TOP_K` | Top-K chunk hits (default `20`) |
| `RAG_MIN_SIMILARITY` | **Leave unset** until empirically chosen |
| `QUERY_LONG_PROMPT_THRESHOLD_WORDS` | Default `200` |
| `QUERY_TARGET_CHUNK_WORDS` | Default `125` |
| `QUERY_CHUNK_OVERLAP_WORDS` | Default `20` |

## Migrations

```bash
export DATABASE_URL='postgresql+psycopg://...'
alembic upgrade head
```

Migration `0002_rag_embeddings` enables **pgvector** and adds nullable embedding columns as `float[]` (dimension not hard-coded). Convert to `vector(N)` later once the model/dimension are fixed.

## Run

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Semantic retrieval

```bash
# Index (embeds when EMBEDDING_* configured)
curl -X PUT http://127.0.0.1:8000/api/rag/elements/text -H 'Content-Type: application/json' -d '{...}'

# Rebuild embeddings after model change
curl -X POST http://127.0.0.1:8000/api/rag/boards/{board_id}/embeddings/rebuild

# Retrieve (cosine similarity only — no spatial scoring)
curl -X POST http://127.0.0.1:8000/api/rag/retrieve -H 'Content-Type: application/json' -d '{
  "board_id": "...",
  "prompt": "Explain Gauss'\''s law"
}'
```

Higher score = more similar. `min_similarity` defaults to `null` (top-K only).

## Tests

```bash
DATABASE_URL='...' pytest
```

Uses fake/deterministic embedders — no paid API / model download.
