from __future__ import annotations

from functools import lru_cache

from ..config import Settings, get_settings
from ..models.chat import DEFAULT_RAG_SYSTEM_INSTRUCTION
from .base import LLMProvider
from .mock_provider import MockProvider
from .openai_provider import OpenAIProvider


class LLMService:
    """Application-facing LLM facade. Routes talk to this, not providers."""

    def __init__(self, provider: LLMProvider) -> None:
        self._provider = provider

    async def generate(
        self,
        prompt: str,
        *,
        system_instruction: str | None = None,
        canvas_context: str | None = None,
    ) -> str:
        cleaned = prompt.strip()
        if not cleaned:
            from ..errors import AiServiceError

            raise AiServiceError(
                "Prompt cannot be empty.",
                code="invalid_prompt",
                status_code=422,
            )

        system = (system_instruction or "").strip() or None
        context = (canvas_context or "").strip() or None
        if context and not system:
            system = DEFAULT_RAG_SYSTEM_INSTRUCTION

        return await self._provider.generate(
            cleaned,
            system_instruction=system,
            canvas_context=context,
        )


def build_llm_service(settings: Settings | None = None) -> LLMService:
    cfg = settings or get_settings()
    if cfg.is_mock_provider:
        return LLMService(MockProvider())
    return LLMService(OpenAIProvider(cfg))


@lru_cache
def get_llm_service() -> LLMService:
    return build_llm_service()
