from __future__ import annotations

from typing import Sequence

from ..models.chat import ImageAttachment
from .base import LLMProvider


class MockProvider(LLMProvider):
    """Deterministic provider for local UI testing without paid API calls.

    Enable with `LLM_PROVIDER=mock` (no API key required).
    """

    def __init__(self, *, supports_image_input: bool = True) -> None:
        self._supports_image_input = supports_image_input

    @property
    def supports_image_input(self) -> bool:
        return self._supports_image_input

    async def generate(
        self,
        prompt: str,
        *,
        system_instruction: str | None = None,
        canvas_context: str | None = None,
        image_attachments: Sequence[ImageAttachment] | None = None,
    ) -> str:
        preview = prompt if len(prompt) <= 120 else f"{prompt[:117]}..."
        lines = [
            "This is a mock AI response for local development.",
            "",
            f"You asked:\n{preview}",
        ]
        if system_instruction:
            lines.append("")
            lines.append(f"[system received: {len(system_instruction)} chars]")
        if canvas_context:
            lines.append("")
            lines.append(f"[canvas_context received: {len(canvas_context)} chars]")
            # Echo element IDs for debug verification.
            for line in canvas_context.splitlines():
                if line.startswith("ID: ") or line.startswith("IMAGE ELEMENT ID:"):
                    lines.append(f"  context {line}")
        if image_attachments:
            lines.append("")
            lines.append(f"[image_attachments received: {len(image_attachments)}]")
            for att in image_attachments:
                lines.append(
                    f"  image element_id={att.element_id} "
                    f"data_url_chars={len(att.data_url)}"
                )
        return "\n".join(lines)
