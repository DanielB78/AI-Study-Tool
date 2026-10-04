from abc import ABC, abstractmethod
from typing import Sequence

from ..models.chat import ImageAttachment


class LLMProvider(ABC):
    """Provider-independent LLM interface."""

    @property
    def supports_image_input(self) -> bool:
        """Whether this provider can accept multimodal image attachments."""
        return False

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        *,
        system_instruction: str | None = None,
        canvas_context: str | None = None,
        image_attachments: Sequence[ImageAttachment] | None = None,
    ) -> str:
        """Return plain text for the user prompt (+ optional system/context/images)."""
