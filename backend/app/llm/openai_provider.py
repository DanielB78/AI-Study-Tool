from __future__ import annotations

import httpx
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    RateLimitError,
)

from ..config import Settings
from ..errors import AiServiceError
from .base import LLMProvider


class OpenAIProvider(LLMProvider):
    """OpenAI Chat Completions implementation of LLMProvider."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = AsyncOpenAI(
            api_key=settings.openai_api_key or "missing",
            base_url=settings.openai_base_url,
            timeout=settings.llm_timeout_seconds,
        )

    async def generate(
        self,
        prompt: str,
        *,
        system_instruction: str | None = None,
        canvas_context: str | None = None,
    ) -> str:
        if not self._settings.has_openai_api_key:
            raise AiServiceError(
                "AI is not configured. Set OPENAI_API_KEY on the backend.",
                code="missing_api_key",
                status_code=503,
                detail="OPENAI_API_KEY is empty",
            )

        messages: list[dict[str, str]] = []
        system_parts: list[str] = []
        if system_instruction:
            system_parts.append(system_instruction)
        if canvas_context:
            system_parts.append(canvas_context)
        if system_parts:
            messages.append({"role": "system", "content": "\n\n".join(system_parts)})
        messages.append({"role": "user", "content": prompt})

        try:
            completion = await self._client.chat.completions.create(
                model=self._settings.openai_model,
                messages=messages,
            )
        except RateLimitError as exc:
            raise AiServiceError(
                "AI request failed. Please try again.",
                code="rate_limit",
                status_code=429,
                detail=str(exc),
            ) from exc
        except APITimeoutError as exc:
            raise AiServiceError(
                "AI request failed. Please try again.",
                code="timeout",
                status_code=504,
                detail=str(exc),
            ) from exc
        except APIConnectionError as exc:
            raise AiServiceError(
                "AI request failed. Please try again.",
                code="provider_unreachable",
                status_code=502,
                detail=str(exc),
            ) from exc
        except APIStatusError as exc:
            raise AiServiceError(
                "AI request failed. Please try again.",
                code="provider_error",
                status_code=502,
                detail=f"{exc.status_code}: {exc.message}",
            ) from exc
        except httpx.HTTPError as exc:
            raise AiServiceError(
                "AI request failed. Please try again.",
                code="network_error",
                status_code=502,
                detail=str(exc),
            ) from exc
        except Exception as exc:  # noqa: BLE001 — last-resort safe mapping
            raise AiServiceError(
                "AI request failed. Please try again.",
                code="provider_error",
                status_code=502,
                detail=str(exc),
            ) from exc

        choice = completion.choices[0] if completion.choices else None
        text = (choice.message.content if choice and choice.message else None) or ""
        text = text.strip()
        if not text:
            raise AiServiceError(
                "AI request failed. Please try again.",
                code="invalid_response",
                status_code=502,
                detail="Empty completion content",
            )
        return text
