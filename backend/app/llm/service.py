from __future__ import annotations

from functools import lru_cache
from typing import Sequence

from ..config import Settings, get_settings
from ..errors import AiServiceError
from ..models.chat import DEFAULT_RAG_SYSTEM_INSTRUCTION, ImageAttachment
from .base import LLMProvider
from .mock_provider import MockProvider
from .openai_provider import OpenAIProvider


class LLMService:
    """Application-facing LLM facade. Routes talk to this, not providers."""

    def __init__(self, provider: LLMProvider) -> None:
        self._provider = provider

    @property
    def supports_image_input(self) -> bool:
        return self._provider.supports_image_input

    async def generate(
        self,
        prompt: str,
        *,
        system_instruction: str | None = None,
        canvas_context: str | None = None,
        image_attachments: Sequence[ImageAttachment] | None = None,
    ) -> str:
        cleaned = prompt.strip()
        if not cleaned:
            raise AiServiceError(
                "Prompt cannot be empty.",
                code="invalid_prompt",
                status_code=422,
            )

        system = (system_instruction or "").strip() or None
        context = (canvas_context or "").strip() or None
        attachments = list(image_attachments or [])
        if context and not system:
            system = DEFAULT_RAG_SYSTEM_INSTRUCTION

        if attachments and not self._provider.supports_image_input:
            ids = ", ".join(a.element_id for a in attachments)
            raise AiServiceError(
                (
                    "This LLM provider/model does not support image input, but "
                    f"{len(attachments)} canvas image(s) are in context ({ids}). "
                    "Use a vision-capable model or exclude the images."
                ),
                code="vision_unsupported",
                status_code=422,
                detail="provider.supports_image_input=false",
            )

        return await self._provider.generate(
            cleaned,
            system_instruction=system,
            canvas_context=context,
            image_attachments=attachments or None,
        )


def build_llm_service(settings: Settings | None = None) -> LLMService:
    cfg = settings or get_settings()
    if cfg.is_mock_provider:
        return LLMService(
            MockProvider(supports_image_input=cfg.llm_supports_image_input),
        )
    return LLMService(OpenAIProvider(cfg))


@lru_cache
def get_llm_service() -> LLMService:
    return build_llm_service()
