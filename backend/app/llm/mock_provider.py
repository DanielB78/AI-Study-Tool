from .base import LLMProvider


class MockProvider(LLMProvider):
    """Deterministic provider for local UI testing without paid API calls.

    Enable with `LLM_PROVIDER=mock` (no API key required).
    """

    async def generate(
        self,
        prompt: str,
        *,
        system_instruction: str | None = None,
        canvas_context: str | None = None,
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
            lines.append(f"[canvas_context received: {len(canvas_context)} chars]")
            # Echo element IDs for debug verification.
            for line in canvas_context.splitlines():
                if line.startswith("ID: "):
                    lines.append(f"  context {line}")
        return "\n".join(lines)
