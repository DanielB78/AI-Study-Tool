from abc import ABC, abstractmethod


class LLMProvider(ABC):
    """Provider-independent LLM interface."""

    @abstractmethod
    async def generate(self, prompt: str) -> str:
        """Return plain text for the given user prompt."""
