from fastapi import APIRouter

from ..config import get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, object]:
    settings = get_settings()
    return {
        "status": "ok",
        "ai_configured": settings.has_openai_api_key or settings.is_mock_provider,
        "model": settings.openai_model if not settings.is_mock_provider else "mock",
        "provider": "mock" if settings.is_mock_provider else "openai",
        "database_configured": settings.has_database_url,
        "embedding_configured": settings.has_embedding_config,
        "embedding_provider": settings.embedding_provider or None,
        "embedding_model": settings.embedding_model or None,
        "embedding_dimension": settings.embedding_dimension,
        "embedding_similarity": settings.effective_similarity_metric,
        "hf_token_configured": settings.has_hf_token,
        "rag_min_similarity": settings.rag_min_similarity,
    }
