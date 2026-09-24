from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import chat, health
from .config import get_settings
from .errors import AiServiceError, ai_service_error_handler


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="AI Study Tool Backend",
        version="0.1.0",
        description="Thin LLM proxy for the StudyBoard editor. No board context in v1.",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )

    app.add_exception_handler(AiServiceError, ai_service_error_handler)
    app.include_router(health.router)
    app.include_router(chat.router)
    return app


app = create_app()
