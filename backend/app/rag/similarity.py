"""Similarity metrics for semantic retrieval.

Score direction: higher = more similar.
"""

from __future__ import annotations

import math

from .embeddings.base import EmbeddingVector


def cosine_similarity(a: EmbeddingVector, b: EmbeddingVector) -> float:
    if len(a) != len(b):
        raise ValueError(f"dimension mismatch: {len(a)} vs {len(b)}")
    if not a:
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b, strict=True):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


def similarity(a: EmbeddingVector, b: EmbeddingVector, metric: str = "cosine") -> float:
    key = metric.strip().lower()
    if key == "cosine":
        return cosine_similarity(a, b)
    raise ValueError(f"unsupported similarity metric: {metric}")
