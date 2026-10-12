from __future__ import annotations

import os

import pytest

from app.config import Settings, get_settings
from app.errors import AiServiceError
from app.rag.embeddings.base import EmbeddingService, EmbeddingVector
from app.rag.embeddings.deterministic import DeterministicEmbeddingService
from app.rag.embeddings.factory import build_embedding_service, reset_embedding_service_cache
from app.rag.embeddings.sentence_transformers_provider import (
    SentenceTransformersEmbeddingService,
)
from app.rag.similarity import cosine_similarity


class RecordingEmbeddingService(EmbeddingService):
    """Test double that records whether query vs document paths were used."""

    def __init__(self, dimension: int = 8) -> None:
        self._dimension = dimension
        self.query_calls: list[str] = []
        self.document_calls: list[list[str]] = []

    @property
    def provider(self) -> str:
        return "recording"

    @property
    def model(self) -> str:
        return "recording-v1"

    @property
    def dimension(self) -> int | None:
        return self._dimension

    def _vec(self, text: str, *, query: bool) -> EmbeddingVector:
        base = [0.0] * self._dimension
        base[0] = 1.0 if query else 0.5
        base[1] = float(len(text) % 7) / 7.0
        return base

    async def embed_text(self, text: str) -> EmbeddingVector:
        return self._vec(text, query=False)

    async def embed_texts(self, texts: list[str]) -> list[EmbeddingVector]:
        return [self._vec(t, query=False) for t in texts]

    async def embed_documents(self, texts: list[str]) -> list[EmbeddingVector]:
        self.document_calls.append(list(texts))
        return await self.embed_texts(texts)

    async def embed_query(self, text: str) -> EmbeddingVector:
        self.query_calls.append(text)
        return self._vec(text, query=True)


@pytest.mark.asyncio
async def test_deterministic_embed_one_and_batch() -> None:
    svc = DeterministicEmbeddingService(model="det-test", dimension=32)
    one = await svc.embed_text("hello")
    batch = await svc.embed_texts(["hello", "world"])
    docs = await svc.embed_documents(["hello", "world"])
    query = await svc.embed_query("hello")
    assert len(one) == 32
    assert batch[0] == one
    assert docs == batch
    assert query == one
    assert batch[0] != batch[1]
    assert abs(sum(v * v for v in one) - 1.0) < 1e-6


@pytest.mark.asyncio
async def test_recording_separates_query_and_document_paths() -> None:
    svc = RecordingEmbeddingService()
    q = await svc.embed_query("electric flux")
    docs = await svc.embed_documents(["doc one", "doc two", "doc three"])
    assert len(q) == 8
    assert len(docs) == 3
    assert all(len(v) == 8 for v in docs)
    assert svc.query_calls == ["electric flux"]
    assert svc.document_calls == [["doc one", "doc two", "doc three"]]


def test_missing_embedding_config_errors() -> None:
    reset_embedding_service_cache()
    get_settings.cache_clear()
    settings = Settings(embedding_provider="", embedding_model="", database_url="x")
    with pytest.raises(AiServiceError) as exc:
        build_embedding_service(settings)
    assert exc.value.code == "missing_embedding_config"
    get_settings.cache_clear()
    reset_embedding_service_cache()


def test_sentence_transformers_requires_hf_token_for_embeddinggemma() -> None:
    settings = Settings(
        embedding_provider="sentence_transformers",
        embedding_model="google/embeddinggemma-300m",
        embedding_dimension=768,
        hf_token="",
        huggingface_hub_token="",
    )
    with pytest.raises(AiServiceError) as exc:
        SentenceTransformersEmbeddingService(settings)
    assert exc.value.code == "missing_hf_token"
    assert "HF_TOKEN" in exc.value.message


def test_sentence_transformers_requires_dimension() -> None:
    settings = Settings(
        embedding_provider="sentence_transformers",
        embedding_model="google/embeddinggemma-300m",
        embedding_dimension=None,
        hf_token="hf_test_token_not_real",
    )
    with pytest.raises(AiServiceError) as exc:
        SentenceTransformersEmbeddingService(settings)
    assert exc.value.code == "missing_embedding_dimension"


def test_factory_builds_sentence_transformers_provider() -> None:
    settings = Settings(
        embedding_provider="sentence_transformers",
        embedding_model="google/embeddinggemma-300m",
        embedding_dimension=768,
        hf_token="hf_test_token_not_real",
    )
    svc = build_embedding_service(settings)
    assert svc.provider == "sentence_transformers"
    assert svc.model == "google/embeddinggemma-300m"
    assert svc.dimension == 768
    assert svc.is_loaded() is False


def test_cosine_identical_and_orthogonal() -> None:
    a = [1.0, 0.0, 0.0]
    b = [1.0, 0.0, 0.0]
    c = [0.0, 1.0, 0.0]
    assert cosine_similarity(a, b) == pytest.approx(1.0)
    assert cosine_similarity(a, c) == pytest.approx(0.0)


def test_cosine_dimension_mismatch() -> None:
    with pytest.raises(ValueError):
        cosine_similarity([1.0, 0.0], [1.0, 0.0, 0.0])


def test_resolved_hf_token_aliases() -> None:
    a = Settings(hf_token="aaa", huggingface_hub_token="")
    b = Settings(hf_token="", huggingface_hub_token="bbb")
    assert a.resolved_hf_token == "aaa"
    assert b.resolved_hf_token == "bbb"


@pytest.mark.embeddinggemma
@pytest.mark.asyncio
async def test_real_embeddinggemma_ranking_and_dims() -> None:
    """Optional integration test — skipped unless RUN_EMBEDDINGGEMMA_TESTS=1."""
    if os.environ.get("RUN_EMBEDDINGGEMMA_TESTS") != "1":
        pytest.skip("Set RUN_EMBEDDINGGEMMA_TESTS=1 to run real EmbeddingGemma tests")
    token = (os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN") or "").strip()
    if not token:
        pytest.skip("HF_TOKEN required for EmbeddingGemma integration test")

    settings = Settings(
        embedding_provider="sentence_transformers",
        embedding_model="google/embeddinggemma-300m",
        embedding_dimension=768,
        embedding_similarity="cosine",
        hf_token=token,
        embedding_device=os.environ.get("EMBEDDING_DEVICE", "cpu"),
    )
    svc = SentenceTransformersEmbeddingService(settings)

    query = await svc.embed_query("electric flux and enclosed charge")
    docs = await svc.embed_documents(
        [
            "Gauss's law relates electric flux through a closed surface to the enclosed charge.",
            "Faraday's law describes electromagnetic induction caused by changing magnetic flux.",
            "The Schrödinger equation governs the evolution of a quantum state.",
        ]
    )
    assert len(query) == 768
    assert len(docs) == 3
    assert all(len(v) == 768 for v in docs)

    scores = [cosine_similarity(query, d) for d in docs]
    assert scores[0] == max(scores)
