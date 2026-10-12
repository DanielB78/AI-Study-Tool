from __future__ import annotations

import hashlib
import math
import struct

from ...errors import AiServiceError
from .base import EmbeddingService, EmbeddingVector


class DeterministicEmbeddingService(EmbeddingService):
    """Hash-based deterministic vectors for tests / local RAG without a paid model.

    NOT a semantic model — only for development when EMBEDDING_PROVIDER=deterministic.
    Vectors are L2-normalized so cosine similarity is well-defined.
    """

    def __init__(self, model: str = "deterministic-hash-v1", dimension: int = 64) -> None:
        if dimension < 8:
            raise AiServiceError(
                "Deterministic embedding dimension must be >= 8.",
                code="invalid_embedding_config",
                status_code=500,
            )
        self._model = model.strip() or "deterministic-hash-v1"
        self._dimension = dimension

    @property
    def provider(self) -> str:
        return "deterministic"

    @property
    def model(self) -> str:
        return self._model

    async def embed_text(self, text: str) -> EmbeddingVector:
        return self._embed(text)

    async def embed_texts(self, texts: list[str]) -> list[EmbeddingVector]:
        return [self._embed(t) for t in texts]

    def _embed(self, text: str) -> EmbeddingVector:
        # Expand a SHA-256 digest into `dimension` pseudo-random floats in [-1, 1].
        seed = hashlib.sha256(text.encode("utf-8")).digest()
        values: list[float] = []
        counter = 0
        while len(values) < self._dimension:
            block = hashlib.sha256(seed + counter.to_bytes(4, "little")).digest()
            for i in range(0, len(block), 4):
                if len(values) >= self._dimension:
                    break
                (unsigned,) = struct.unpack_from(">I", block, i)
                values.append((unsigned / 0xFFFFFFFF) * 2.0 - 1.0)
            counter += 1
        # L2 normalize
        norm = math.sqrt(sum(v * v for v in values)) or 1.0
        return [v / norm for v in values]
