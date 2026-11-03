"""Hash helpers for AI interaction memory."""

from __future__ import annotations

from ..rag.hashing import content_hash


def interaction_content_hash(user_prompt: str, action_summary: str) -> str:
    """SHA-256 over prompt + summary (geometry-free)."""
    payload = "\n".join(
        [
            "USER REQUEST:",
            (user_prompt or "").strip() or "(empty)",
            "",
            "ACTION PERFORMED:",
            (action_summary or "").strip() or "(none)",
        ]
    )
    return content_hash(payload)
