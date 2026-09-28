"""Development endpoints for embedding status and smoke ranking tests."""

from __future__ import annotations

from pydantic import BaseModel, Field

from fastapi import APIRouter

from ..config import get_settings
from ..errors import AiServiceError
from .embeddings.factory import build_embedding_service, get_embedding_service, reset_embedding_service_cache
from .similarity import cosine_similarity

router = APIRouter(prefix="/api/rag/embedding", tags=["rag-embedding"])


class EmbeddingStatusResponse(BaseModel):
    provider: str | None
    model: str | None
    dimension: int | None
    similarity: str
    loaded: bool
    configured: bool
    hf_token_configured: bool
    rag_min_similarity: float | None = None


class EmbeddingSmokeDocument(BaseModel):
    id: str
    text: str


class EmbeddingSmokeRequest(BaseModel):
    prompt: str = Field(
        default="electric flux and enclosed charge",
        min_length=1,
    )
    documents: list[EmbeddingSmokeDocument] = Field(
        default_factory=lambda: [
            EmbeddingSmokeDocument(
                id="gauss",
                text=(
                    "Gauss's law relates electric flux through a closed surface "
                    "to the enclosed charge."
                ),
            ),
            EmbeddingSmokeDocument(
                id="faraday",
                text=(
                    "Faraday's law describes electromagnetic induction caused by "
                    "changing magnetic flux."
                ),
            ),
            EmbeddingSmokeDocument(
                id="schrodinger",
                text=(
                    "The Schrödinger equation governs the evolution of a quantum state."
                ),
            ),
        ]
    )


class EmbeddingSmokeHit(BaseModel):
    id: str
    score: float
    text: str


class EmbeddingSmokeResponse(BaseModel):
    provider: str
    model: str
    dimension: int
    query_dimension: int
    document_dimensions: list[int]
    ranking: list[EmbeddingSmokeHit]
    top_id: str | None


@router.get("/status", response_model=EmbeddingStatusResponse)
async def embedding_status() -> EmbeddingStatusResponse:
    settings = get_settings()
    if not settings.has_embedding_config:
        return EmbeddingStatusResponse(
            provider=None,
            model=None,
            dimension=settings.embedding_dimension,
            similarity=settings.effective_similarity_metric,
            loaded=False,
            configured=False,
            hf_token_configured=settings.has_hf_token,
            rag_min_similarity=settings.rag_min_similarity,
        )

    try:
        service = get_embedding_service()
    except AiServiceError:
        # Config present but provider cannot be constructed (e.g. missing HF token).
        return EmbeddingStatusResponse(
            provider=settings.embedding_provider or None,
            model=settings.embedding_model or None,
            dimension=settings.embedding_dimension,
            similarity=settings.effective_similarity_metric,
            loaded=False,
            configured=True,
            hf_token_configured=settings.has_hf_token,
            rag_min_similarity=settings.rag_min_similarity,
        )

    return EmbeddingStatusResponse(
        provider=service.provider,
        model=service.model,
        dimension=service.dimension if service.dimension is not None else settings.embedding_dimension,
        similarity=settings.effective_similarity_metric,
        loaded=service.is_loaded(),
        configured=True,
        hf_token_configured=settings.has_hf_token,
        rag_min_similarity=settings.rag_min_similarity,
    )


@router.post("/smoke", response_model=EmbeddingSmokeResponse)
async def embedding_smoke(body: EmbeddingSmokeRequest | None = None) -> EmbeddingSmokeResponse:
    """Dev ranking check: encode_query vs encode_document, no DB writes."""
    payload = body or EmbeddingSmokeRequest()
    if not payload.documents:
        raise AiServiceError(
            "At least one document is required.",
            code="invalid_smoke_request",
            status_code=422,
        )

    settings = get_settings()
    # Use the process-wide cached provider so the model stays loaded for RAG.
    service = get_embedding_service()

    query_vec = await service.embed_query(payload.prompt)
    doc_vecs = await service.embed_documents([d.text for d in payload.documents])

    ranking = []
    for doc, vec in zip(payload.documents, doc_vecs, strict=True):
        score = cosine_similarity(query_vec, vec)
        ranking.append(EmbeddingSmokeHit(id=doc.id, score=score, text=doc.text))
    ranking.sort(key=lambda h: h.score, reverse=True)

    dim = service.dimension or len(query_vec)
    return EmbeddingSmokeResponse(
        provider=service.provider,
        model=service.model,
        dimension=dim,
        query_dimension=len(query_vec),
        document_dimensions=[len(v) for v in doc_vecs],
        ranking=ranking,
        top_id=ranking[0].id if ranking else None,
    )


@router.post("/reload")
async def reload_embedding_service() -> dict[str, object]:
    """Clear the cached provider (dev only — next request reloads the model)."""
    reset_embedding_service_cache()
    get_settings.cache_clear()
    return {"reloaded": True}
