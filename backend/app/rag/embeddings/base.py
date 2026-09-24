from __future__ import annotations

from abc import ABC, abstractmethod

# Canonical vector type used across RAG — dimension is model-dependent.
EmbeddingVector = list[float]


class EmbeddingService(ABC):
    """Provider-independent embedding interface.

    The SAME service/model must embed both document chunks and user queries.
    """

    @property
    @abstractmethod
    def provider(self) -> str:
        """Configured provider id (e.g. openai, deterministic)."""

    @property
    @abstractmethod
    def model(self) -> str:
        """Configured model id — stored alongside each embedding."""

    @abstractmethod
    async def embed_text(self, text: str) -> EmbeddingVector:
        """Embed a single string."""

    @abstractmethod
    async def embed_texts(self, texts: list[str]) -> list[EmbeddingVector]:
        """Batch embed; implementations may fall back to sequential calls."""

    async def embed_query(self, text: str) -> EmbeddingVector:
        """Query embedding entry-point (same space as documents by default)."""
        return await self.embed_text(text)

    async def embed_queries(self, texts: list[str]) -> list[EmbeddingVector]:
        return await self.embed_texts(texts)
