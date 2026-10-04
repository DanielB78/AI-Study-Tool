from __future__ import annotations

from typing import Any, Sequence

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
from ..models.chat import ImageAttachment
from .base import LLMProvider


def _guess_media_type(data_url: str, media_type: str | None) -> str | None:
    if media_type:
        return media_type
    if data_url.startswith("data:"):
        # data:image/png;base64,...
        header = data_url.split(",", 1)[0]
        if ";" in header:
            return header[5:].split(";", 1)[0] or None
        return header[5:] or None
    return None


class OpenAIProvider(LLMProvider):
    """OpenAI Chat Completions implementation of LLMProvider."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = AsyncOpenAI(
            api_key=settings.openai_api_key or "missing",
            base_url=settings.openai_base_url,
            timeout=settings.llm_timeout_seconds,
        )

    @property
    def supports_image_input(self) -> bool:
        return self._settings.llm_supports_image_input

    async def generate(
        self,
        prompt: str,
        *,
        system_instruction: str | None = None,
        canvas_context: str | None = None,
        image_attachments: Sequence[ImageAttachment] | None = None,
    ) -> str:
        if not self._settings.has_openai_api_key:
            raise AiServiceError(
                "AI is not configured. Set OPENAI_API_KEY on the backend.",
                code="missing_api_key",
                status_code=503,
                detail="OPENAI_API_KEY is empty",
            )

        attachments = list(image_attachments or [])
        if attachments and not self.supports_image_input:
            ids = ", ".join(a.element_id for a in attachments)
            raise AiServiceError(
                (
                    "This LLM provider/model does not support image input, but "
                    f"{len(attachments)} canvas image(s) are in context ({ids}). "
                    "Use a vision-capable model or exclude the images."
                ),
                code="vision_unsupported",
                status_code=422,
                detail="llm_supports_image_input=false",
            )

        messages: list[dict[str, Any]] = []
        system_parts: list[str] = []
        if system_instruction:
            system_parts.append(system_instruction)
        if canvas_context:
            system_parts.append(canvas_context)
        if system_parts:
            messages.append({"role": "system", "content": "\n\n".join(system_parts)})

        if attachments:
            user_content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
            for att in attachments:
                # Canvas images are user/canvas data — never system instructions.
                image_url: dict[str, Any] = {"url": att.data_url}
                media = _guess_media_type(att.data_url, att.media_type)
                if media:
                    # OpenAI ignores media_type on image_url today; keep for clarity.
                    image_url["detail"] = "auto"
                user_content.append(
                    {
                        "type": "image_url",
                        "image_url": image_url,
                    }
                )
            messages.append({"role": "user", "content": user_content})
        else:
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
