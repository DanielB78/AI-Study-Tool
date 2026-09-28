from __future__ import annotations

from app.rag.embeddings.base import EmbeddingService, EmbeddingVector

# Match production pgvector column vector(768).
FAKE_EMBEDDING_DIM = 768


class FakeSemanticEmbeddingService(EmbeddingService):
    """Test double: maps known phrases to hand-crafted vectors for ranking tests."""

    def __init__(self, dimension: int = FAKE_EMBEDDING_DIM) -> None:
        self._model = "fake-semantic-v1"
        self._dimension = dimension
        # Basis vectors for topics (orthogonal-ish) in the first 4 dims; rest zero.
        self._topics = {
            "gauss": [1.0, 0.0, 0.0, 0.0],
            "faraday": [0.0, 1.0, 0.0, 0.0],
            "schrodinger": [0.0, 0.0, 1.0, 0.0],
            "other": [0.0, 0.0, 0.0, 1.0],
        }

    @property
    def provider(self) -> str:
        return "fake"

    @property
    def model(self) -> str:
        return self._model

    @property
    def dimension(self) -> int | None:
        return self._dimension

    def _pad(self, head: list[float]) -> EmbeddingVector:
        if len(head) >= self._dimension:
            return head[: self._dimension]
        return head + [0.0] * (self._dimension - len(head))

    def _classify(self, text: str) -> EmbeddingVector:
        lower = text.lower()
        if "gauss" in lower or "electric flux" in lower or "enclosed charge" in lower:
            return self._pad(list(self._topics["gauss"]))
        if "faraday" in lower or "induction" in lower:
            return self._pad(list(self._topics["faraday"]))
        if "schrodinger" in lower or "schrödinger" in lower or "quantum" in lower:
            return self._pad(list(self._topics["schrodinger"]))
        return self._pad(list(self._topics["other"]))

    async def embed_text(self, text: str) -> EmbeddingVector:
        return self._classify(text)

    async def embed_texts(self, texts: list[str]) -> list[EmbeddingVector]:
        return [self._classify(t) for t in texts]
