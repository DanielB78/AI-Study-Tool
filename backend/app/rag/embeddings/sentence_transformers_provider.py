"""Local SentenceTransformers embedding provider (EmbeddingGemma and peers)."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from ...config import Settings
from ...errors import AiServiceError
from .base import EmbeddingService, EmbeddingVector

logger = logging.getLogger(__name__)

# Phrases that indicate gated-model / auth failures (never include the token itself).
_GATED_HINTS = (
    "401",
    "403",
    "gated",
    "unauthorized",
    "authentication",
    "access to model",
    "restricted",
    "cannot access",
    "not a member",
    "agree to share",
    "license",
)


def _looks_like_gated_or_auth_error(message: str) -> bool:
    lower = message.lower()
    return any(h in lower for h in _GATED_HINTS)


def _redact_secrets(message: str, *secrets: str) -> str:
    redacted = message
    for secret in secrets:
        if secret and secret.strip():
            redacted = redacted.replace(secret.strip(), "***")
    return redacted


class SentenceTransformersEmbeddingService(EmbeddingService):
    """Lazy-loaded SentenceTransformer wrapper with query/document encode paths.

    Designed for google/embeddinggemma-300m:
      - documents → encode_document(...)
      - queries → encode_query(...)
    """

    def __init__(self, settings: Settings) -> None:
        model = settings.embedding_model.strip()
        if not model:
            raise AiServiceError(
                "Embedding model is not configured. Set EMBEDDING_MODEL.",
                code="missing_embedding_model",
                status_code=503,
            )
        dim = settings.embedding_dimension
        if dim is None or dim <= 0:
            raise AiServiceError(
                "EMBEDDING_DIMENSION must be set for sentence_transformers "
                "(use 768 for google/embeddinggemma-300m).",
                code="missing_embedding_dimension",
                status_code=503,
            )

        token = settings.resolved_hf_token
        if model.startswith("google/embeddinggemma") and not token:
            raise AiServiceError(
                "EmbeddingGemma access failed. Ensure the Gemma license has been "
                "accepted on Hugging Face and HF_TOKEN is configured.",
                code="missing_hf_token",
                status_code=503,
                detail="HF_TOKEN / HUGGINGFACE_HUB_TOKEN empty",
            )

        self._settings = settings
        self._model_id = model
        self._expected_dim = int(dim)
        self._batch_size = max(1, settings.embedding_batch_size)
        self._device = (settings.embedding_device or "").strip() or None
        self._hf_token = token
        self._model: Any | None = None
        self._load_lock = asyncio.Lock()

    @property
    def provider(self) -> str:
        return "sentence_transformers"

    @property
    def model(self) -> str:
        return self._model_id

    @property
    def dimension(self) -> int | None:
        return self._expected_dim

    def is_loaded(self) -> bool:
        return self._model is not None

    def _apply_hf_token_env(self) -> None:
        """Ensure huggingface_hub sees the token without logging it."""
        if not self._hf_token:
            return
        # Prefer HF_TOKEN; also set HUGGINGFACE_HUB_TOKEN for older hub versions.
        os.environ.setdefault("HF_TOKEN", self._hf_token)
        os.environ.setdefault("HUGGINGFACE_HUB_TOKEN", self._hf_token)

    def _load_model_sync(self) -> Any:
        self._apply_hf_token_env()
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise AiServiceError(
                "sentence-transformers is not installed. "
                "Install backend dependencies (pip install -r requirements.txt).",
                code="missing_sentence_transformers",
                status_code=503,
                detail=str(exc),
            ) from exc

        kwargs: dict[str, Any] = {}
        if self._hf_token:
            kwargs["token"] = self._hf_token
        if self._device:
            kwargs["device"] = self._device

        try:
            model = SentenceTransformer(self._model_id, **kwargs)
        except Exception as exc:  # noqa: BLE001
            raise self._map_load_error(exc) from exc

        # Validate output dimension with a tiny probe (query path).
        try:
            probe = model.encode_query("dimension probe")
        except AttributeError:
            # Older ST without encode_query — should not happen for EmbeddingGemma.
            probe = model.encode("dimension probe", prompt_name="query")
        except Exception as exc:  # noqa: BLE001
            raise self._map_load_error(exc) from exc

        vector = self._to_list(probe)
        if len(vector) != self._expected_dim:
            raise AiServiceError(
                f"Embedding dimension mismatch: model produced {len(vector)} dims, "
                f"but EMBEDDING_DIMENSION={self._expected_dim}. "
                "Do not truncate EmbeddingGemma below 768 in this configuration.",
                code="embedding_dimension_mismatch",
                status_code=500,
                detail=f"got={len(vector)} expected={self._expected_dim}",
            )
        logger.info(
            "Loaded SentenceTransformer model=%s dim=%s device=%s",
            self._model_id,
            self._expected_dim,
            getattr(model, "device", self._device or "auto"),
        )
        return model

    def _map_load_error(self, exc: BaseException) -> AiServiceError:
        raw = _redact_secrets(str(exc), self._hf_token or "")
        if _looks_like_gated_or_auth_error(raw):
            return AiServiceError(
                "EmbeddingGemma access failed. Ensure the Gemma license has been "
                "accepted on Hugging Face and HF_TOKEN is configured.",
                code="hf_gated_model_access",
                status_code=503,
                detail=raw[:500],
            )
        lower = raw.lower()
        if "out of memory" in lower or "oom" in lower:
            return AiServiceError(
                "Embedding model failed to load due to insufficient memory.",
                code="embedding_oom",
                status_code=503,
                detail=raw[:500],
            )
        if "connection" in lower or "network" in lower or "timed out" in lower:
            return AiServiceError(
                "Could not download the embedding model. Check network access "
                "and the Hugging Face cache, then retry.",
                code="embedding_download_failed",
                status_code=503,
                detail=raw[:500],
            )
        return AiServiceError(
            "Failed to load the SentenceTransformers embedding model.",
            code="embedding_model_load_failed",
            status_code=503,
            detail=raw[:500],
        )

    async def _ensure_model(self) -> Any:
        if self._model is not None:
            return self._model
        async with self._load_lock:
            if self._model is not None:
                return self._model
            self._model = await asyncio.to_thread(self._load_model_sync)
            return self._model

    @staticmethod
    def _to_list(value: Any) -> EmbeddingVector:
        if hasattr(value, "tolist"):
            value = value.tolist()
        if isinstance(value, list) and value and isinstance(value[0], list):
            # Unexpected batch shape for a single vector.
            value = value[0]
        return [float(x) for x in value]

    @staticmethod
    def _to_list_batch(value: Any) -> list[EmbeddingVector]:
        if hasattr(value, "tolist"):
            value = value.tolist()
        if not isinstance(value, list):
            raise TypeError(f"Unexpected embedding batch type: {type(value)!r}")
        if value and isinstance(value[0], (int, float)):
            # Single vector returned for a 1-item batch.
            return [[float(x) for x in value]]
        return [[float(x) for x in row] for row in value]

    def _encode_documents_sync(self, model: Any, texts: list[str]) -> list[EmbeddingVector]:
        if not texts:
            return []
        encode_doc = getattr(model, "encode_document", None)
        if encode_doc is None:
            raise AiServiceError(
                "Loaded SentenceTransformer model does not support encode_document(). "
                "Upgrade sentence-transformers or use a model that provides it.",
                code="missing_encode_document",
                status_code=500,
            )
        out: list[EmbeddingVector] = []
        for start in range(0, len(texts), self._batch_size):
            batch = texts[start : start + self._batch_size]
            try:
                raw = encode_doc(batch)
            except Exception as exc:  # noqa: BLE001
                raise self._map_inference_error(exc) from exc
            out.extend(self._to_list_batch(raw))
        self._assert_dims(out)
        return out

    def _encode_queries_sync(self, model: Any, texts: list[str]) -> list[EmbeddingVector]:
        if not texts:
            return []
        encode_query = getattr(model, "encode_query", None)
        if encode_query is None:
            raise AiServiceError(
                "Loaded SentenceTransformer model does not support encode_query(). "
                "Upgrade sentence-transformers or use a model that provides it.",
                code="missing_encode_query",
                status_code=500,
            )
        out: list[EmbeddingVector] = []
        for start in range(0, len(texts), self._batch_size):
            batch = texts[start : start + self._batch_size]
            try:
                # encode_query accepts str or list in recent ST versions.
                raw = encode_query(batch if len(batch) > 1 else batch[0])
            except TypeError:
                # Fallback: encode one-by-one if list unsupported.
                try:
                    raw = [encode_query(t) for t in batch]
                except Exception as exc:  # noqa: BLE001
                    raise self._map_inference_error(exc) from exc
            except Exception as exc:  # noqa: BLE001
                raise self._map_inference_error(exc) from exc
            if len(batch) == 1 and not (isinstance(raw, list) and raw and isinstance(raw[0], (list, tuple))):
                out.append(self._to_list(raw))
            else:
                out.extend(self._to_list_batch(raw))
        self._assert_dims(out)
        return out

    def _assert_dims(self, vectors: list[EmbeddingVector]) -> None:
        for i, vec in enumerate(vectors):
            if len(vec) != self._expected_dim:
                raise AiServiceError(
                    f"Embedding dimension mismatch at index {i}: got {len(vec)}, "
                    f"expected {self._expected_dim}.",
                    code="embedding_dimension_mismatch",
                    status_code=500,
                )

    def _map_inference_error(self, exc: BaseException) -> AiServiceError:
        raw = _redact_secrets(str(exc), self._hf_token or "")
        if _looks_like_gated_or_auth_error(raw):
            return AiServiceError(
                "EmbeddingGemma access failed. Ensure the Gemma license has been "
                "accepted on Hugging Face and HF_TOKEN is configured.",
                code="hf_gated_model_access",
                status_code=503,
                detail=raw[:500],
            )
        return AiServiceError(
            "Embedding inference failed.",
            code="embedding_inference_error",
            status_code=502,
            detail=raw[:500],
        )

    async def embed_text(self, text: str) -> EmbeddingVector:
        return await self.embed_document(text)

    async def embed_texts(self, texts: list[str]) -> list[EmbeddingVector]:
        return await self.embed_documents(texts)

    async def embed_documents(self, texts: list[str]) -> list[EmbeddingVector]:
        if not texts:
            return []
        model = await self._ensure_model()
        return await asyncio.to_thread(self._encode_documents_sync, model, list(texts))

    async def embed_query(self, text: str) -> EmbeddingVector:
        vectors = await self.embed_queries([text])
        return vectors[0]

    async def embed_queries(self, texts: list[str]) -> list[EmbeddingVector]:
        if not texts:
            return []
        model = await self._ensure_model()
        return await asyncio.to_thread(self._encode_queries_sync, model, list(texts))
