from abc import ABC, abstractmethod


class LLMProvider(ABC):
    """Provider-independent LLM interface."""

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        *,
        system_instruction: str | None = None,
        canvas_context: str | None = None,
    ) -> str:
        """Return plain text for the user prompt (+ optional system/context)."""
