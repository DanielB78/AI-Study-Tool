"""Narrow undo/redo intent detector — phrase match only, no LLM."""

from __future__ import annotations

import re
from typing import Literal

UndoIntent = Literal["undo", "redo"]

# Exact-ish phrase lists (case-insensitive, punctuation stripped at edges).
_UNDO_PHRASES = (
    "undo what you just did",
    "undo that",
    "undo your last change",
    "undo the last ai change",
)
_REDO_PHRASES = (
    "redo that",
    "redo what you just undid",
    "redo your last change",
)


def _normalize(prompt: str) -> str:
    text = prompt.strip().lower()
    # Collapse whitespace; strip trailing punctuation commonly typed in chat.
    text = re.sub(r"\s+", " ", text)
    text = text.rstrip(".!?,;:")
    return text


def detect_undo_intent(prompt: str) -> UndoIntent | None:
    """Return ``'undo'`` / ``'redo'`` only for clear imperative phrases.

    Must NOT match explanatory or content-creation prompts such as
    ``explain what undo means`` or ``write a note about undo``.
    """
    normalized = _normalize(prompt)
    if not normalized:
        return None

    for phrase in _UNDO_PHRASES:
        if normalized == phrase:
            return "undo"

    for phrase in _REDO_PHRASES:
        if normalized == phrase:
            return "redo"

    return None
