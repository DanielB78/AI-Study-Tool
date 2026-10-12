from pathlib import Path

AGENT_PROMPTS_DIR = Path(__file__).resolve().parent


def load_canvas_editor_system_prompt() -> str:
    path = AGENT_PROMPTS_DIR / "canvas_editor_system.md"
    return path.read_text(encoding="utf-8")


__all__ = ["load_canvas_editor_system_prompt", "AGENT_PROMPTS_DIR"]
