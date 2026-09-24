from __future__ import annotations

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    RateLimitError,
)

from ...config import Settings
from ...errors import AiServiceError
from .base import EmbeddingService, EmbeddingVector


class OpenAIEmbeddingService(EmbeddingService):
    """OpenAI embeddings API implementation of EmbeddingService."""

    def __init__(self, settings: Settings) -> None:
        if not settings.embedding_model.strip():
            raise AiServiceError(
                "Embedding model is not configured. Set EMBEDDING_MODEL.",
                code="missing_embedding_model",
                status_code=503,
            )
        if not settings.has_openai_api_key:
            raise AiServiceError(
                "OpenAI embeddings require OPENAI_API_KEY.",
                code="missing_api_key",
                status_code=503,
            )
        self._model = settings.embedding_model.strip()
        self._client = AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
            timeout=settings.llm_timeout_seconds,
        )

    @property
    def provider(self) -> str:
        return "openai"

    @property
    def model(self) -> str:
        return self._model

    async def embed_text(self, text: str) -> EmbeddingVector:
        vectors = await self.embed_texts([text])
        return vectors[0]

    async def embed_texts(self, texts: list[str]) -> list[EmbeddingVector]:
        if not texts:
            return []
        try:
            response = await self._client.embeddings.create(
                model=self._model,
                input=texts,
            )
        except RateLimitError as exc:
            raise AiServiceError(
                "Embedding request failed. Please try again.",
                code="rate_limit",
                status_code=429,
                detail=str(exc),
            ) from exc
        except (APITimeoutError, APIConnectionError, APIStatusError) as exc:
            raise AiServiceError(
                "Embedding request failed. Please try again.",
                code="embedding_provider_error",
                status_code=502,
                detail=str(exc),
            ) from exc
        except Exception as exc:  # noqa: BLE001
            raise AiServiceError(
                "Embedding request failed. Please try again.",
                code="embedding_provider_error",
                status_code=502,
                detail=str(exc),
            ) from exc

        # OpenAI returns data sorted by index.
        ordered = sorted(response.data, key=lambda item: item.index)
        return [list(item.embedding) for item in ordered]
