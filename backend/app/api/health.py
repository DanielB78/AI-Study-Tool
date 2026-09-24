from fastapi import APIRouter

from ..config import get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, object]:
    settings = get_settings()
    return {
        "status": "ok",
        "ai_configured": settings.has_openai_api_key,
        "model": settings.openai_model,
    }
