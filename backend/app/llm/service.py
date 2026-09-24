from __future__ import annotations

from functools import lru_cache

from ..config import Settings, get_settings
from .base import LLMProvider
from .openai_provider import OpenAIProvider


class LLMService:
    """Application-facing LLM facade. Routes talk to this, not providers."""

    def __init__(self, provider: LLMProvider) -> None:
        self._provider = provider

    async def generate(self, prompt: str) -> str:
        cleaned = prompt.strip()
        if not cleaned:
            # Defensive; FastAPI/Pydantic already reject empty prompts.
            from ..errors import AiServiceError

            raise AiServiceError(
                "Prompt cannot be empty.",
                code="invalid_prompt",
                status_code=422,
            )
        return await self._provider.generate(cleaned)


def build_llm_service(settings: Settings | None = None) -> LLMService:
    cfg = settings or get_settings()
    return LLMService(OpenAIProvider(cfg))


@lru_cache
def get_llm_service() -> LLMService:
    return build_llm_service()
