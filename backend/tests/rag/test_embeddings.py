from __future__ import annotations

import pytest

from app.rag.embeddings.deterministic import DeterministicEmbeddingService
from app.rag.embeddings.factory import build_embedding_service, reset_embedding_service_cache
from app.config import Settings, get_settings
from app.errors import AiServiceError
from app.rag.similarity import cosine_similarity


@pytest.mark.asyncio
async def test_deterministic_embed_one_and_batch() -> None:
    svc = DeterministicEmbeddingService(model="det-test", dimension=32)
    one = await svc.embed_text("hello")
    batch = await svc.embed_texts(["hello", "world"])
    assert len(one) == 32
    assert batch[0] == one
    assert batch[0] != batch[1]
    # Normalized
    assert abs(sum(v * v for v in one) - 1.0) < 1e-6


def test_missing_embedding_config_errors() -> None:
    reset_embedding_service_cache()
    get_settings.cache_clear()
    settings = Settings(embedding_provider="", embedding_model="", database_url="x")
    with pytest.raises(AiServiceError) as exc:
        build_embedding_service(settings)
    assert exc.value.code == "missing_embedding_config"
    get_settings.cache_clear()
    reset_embedding_service_cache()


def test_cosine_identical_and_orthogonal() -> None:
    a = [1.0, 0.0, 0.0]
    b = [1.0, 0.0, 0.0]
    c = [0.0, 1.0, 0.0]
    assert cosine_similarity(a, b) == pytest.approx(1.0)
    assert cosine_similarity(a, c) == pytest.approx(0.0)


def test_cosine_dimension_mismatch() -> None:
    with pytest.raises(ValueError):
        cosine_similarity([1.0, 0.0], [1.0, 0.0, 0.0])
