from .base import LLMProvider


class MockProvider(LLMProvider):
    """Deterministic provider for local UI testing without paid API calls.

    Enable with `LLM_PROVIDER=mock` (no API key required).
    """

    async def generate(self, prompt: str) -> str:
        preview = prompt if len(prompt) <= 120 else f"{prompt[:117]}..."
        return (
            "This is a mock AI response for local development.\n\n"
            f"You asked:\n{preview}"
        )
