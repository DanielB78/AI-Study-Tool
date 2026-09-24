from __future__ import annotations

from app.rag.embeddings.base import EmbeddingService, EmbeddingVector


class FakeSemanticEmbeddingService(EmbeddingService):
    """Test double: maps known phrases to hand-crafted vectors for ranking tests."""

    def __init__(self) -> None:
        self._model = "fake-semantic-v1"
        # Basis vectors for topics (orthogonal-ish).
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

    def _classify(self, text: str) -> EmbeddingVector:
        lower = text.lower()
        if "gauss" in lower or "electric flux" in lower or "enclosed charge" in lower:
            return list(self._topics["gauss"])
        if "faraday" in lower or "induction" in lower:
            return list(self._topics["faraday"])
        if "schrodinger" in lower or "schrödinger" in lower or "quantum" in lower:
            return list(self._topics["schrodinger"])
        return list(self._topics["other"])

    async def embed_text(self, text: str) -> EmbeddingVector:
        return self._classify(text)

    async def embed_texts(self, texts: list[str]) -> list[EmbeddingVector]:
        return [self._classify(t) for t in texts]
