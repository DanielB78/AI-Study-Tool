from __future__ import annotations

import hashlib

from .chunker import normalize_text_for_hash


def content_hash(text: str) -> str:
    """SHA-256 of normalized text content (geometry must not affect this)."""
    normalized = normalize_text_for_hash(text)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()
