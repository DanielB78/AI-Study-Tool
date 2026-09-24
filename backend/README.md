# AI Study Tool — Backend

Thin FastAPI service that accepts a prompt and returns plain text from an LLM.

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
| `OPENAI_BASE_URL` | Optional API base override |
| `LLM_TIMEOUT_SECONDS` | Request timeout (default `60`) |
| `CORS_ORIGINS` | Comma-separated allowed browser origins |

Never commit `.env`.

## Run

```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Endpoints

### `GET /health`

```json
{ "status": "ok", "ai_configured": true, "model": "gpt-4o-mini" }
```

### `POST /api/chat`

Request:

```json
{ "prompt": "Explain Faraday's law simply" }
```

Response:

```json
{ "text": "..." }
```

Error:

```json
{ "error": { "code": "missing_api_key", "message": "AI is not configured. Set OPENAI_API_KEY on the backend." } }
```

## Tests

```bash
pytest
```

Provider calls are mocked — no paid API usage.
