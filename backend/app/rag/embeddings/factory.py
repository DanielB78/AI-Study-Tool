from __future__ import annotations

from functools import lru_cache

from ...config import Settings, get_settings
from ...errors import AiServiceError
from .base import EmbeddingService
from .deterministic import DeterministicEmbeddingService
from .openai_provider import OpenAIEmbeddingService


def build_embedding_service(settings: Settings | None = None) -> EmbeddingService:
    """Create the configured embedding provider. Model/provider must be explicit."""
    cfg = settings or get_settings()
    provider = cfg.embedding_provider.strip().lower()
    model = cfg.embedding_model.strip()

    if not provider or not model:
        raise AiServiceError(
            "Embedding is not configured. Set EMBEDDING_PROVIDER and EMBEDDING_MODEL.",
            code="missing_embedding_config",
            status_code=503,
            detail="EMBEDDING_PROVIDER/EMBEDDING_MODEL empty",
        )

    if provider in {"deterministic", "hash", "mock"}:
        dim = cfg.embedding_dimension or 64
        return DeterministicEmbeddingService(model=model, dimension=dim)

    if provider == "openai":
        return OpenAIEmbeddingService(cfg)

    raise AiServiceError(
        f"Unknown embedding provider '{provider}'.",
        code="invalid_embedding_provider",
        status_code=500,
        detail=provider,
    )


@lru_cache
def get_embedding_service() -> EmbeddingService:
    return build_embedding_service()


def reset_embedding_service_cache() -> None:
    get_embedding_service.cache_clear()
