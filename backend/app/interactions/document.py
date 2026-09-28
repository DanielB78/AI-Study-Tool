"""Embedding document builder for AI interactions (not raw JSON)."""

from __future__ import annotations

from ..rag.hashing import content_hash


def build_interaction_embedding_document(user_prompt: str, action_summary: str) -> str:
    """Format an interaction as a semantic document for embedding.

    Shape::

        USER REQUEST:
        ...

        ACTION PERFORMED:
        ...
    """
    return "\n".join(
        [
            "USER REQUEST:",
            (user_prompt or "").strip() or "(empty)",
            "",
            "ACTION PERFORMED:",
            (action_summary or "").strip() or "(none)",
        ]
    )


def interaction_content_hash(user_prompt: str, action_summary: str) -> str:
    """SHA-256 of the embedding document (same hasher as RAG chunks)."""
    return content_hash(build_interaction_embedding_document(user_prompt, action_summary))
