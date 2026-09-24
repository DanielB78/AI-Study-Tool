# AI Study Tool — Backend

FastAPI service: LLM chat proxy + RAG text indexing (no embeddings yet).

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env`:

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Provider secret (required for chat when `LLM_PROVIDER=openai`) |
| `OPENAI_MODEL` | Model id (default `gpt-4o-mini`) |
| `LLM_PROVIDER` | `openai` (default) or `mock` for key-free local UI testing |
| `DATABASE_URL` | PostgreSQL URL, e.g. `postgresql+psycopg://user:pass@127.0.0.1:5432/studyboard` |
| `OPENAI_BASE_URL` | Optional API base override |
| `LLM_TIMEOUT_SECONDS` | Request timeout (default `60`) |
| `CORS_ORIGINS` | Comma-separated allowed browser origins |
| `RAG_SHORT_TEXT_THRESHOLD` | ≤ this many words → one chunk (default `100`) |
| `RAG_TARGET_CHUNK_WORDS` | Target words per chunk (default `75`) |
| `RAG_CHUNK_OVERLAP_WORDS` | Overlap words (default `15`) |

Never commit `.env`.

## Database migrations

```bash
cd backend
export DATABASE_URL='postgresql+psycopg://studyboard:studyboard@127.0.0.1:5432/studyboard'
alembic upgrade head
```

## Run

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## RAG endpoints

- `PUT /api/rag/elements/text` — upsert/index a text element (re-chunk on text change; geometry-only when hash matches)
- `PATCH /api/rag/elements/{board_id}/{element_id}/geometry` — geometry-only update
- `DELETE /api/rag/elements/{board_id}/{element_id}` — remove element chunks
- `POST /api/rag/boards/{board_id}/reindex` — rebuild board index from payload
- `GET /api/rag/boards/{board_id}/chunks` — debug list of stored chunks (no embeddings)

## Chat endpoints

### `GET /health`

### `POST /api/chat`

```json
{ "prompt": "Explain Faraday's law simply" }
```

→ `{ "text": "..." }`

## Tests

```bash
cd backend
DATABASE_URL='postgresql+psycopg://...' pytest
```

Chunker tests need no database. Indexing tests require Postgres + migrations applied.
No embedding model is used.
