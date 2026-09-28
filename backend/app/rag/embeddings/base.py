from __future__ import annotations

from abc import ABC, abstractmethod

# Canonical vector type used across RAG — dimension is model-dependent.
EmbeddingVector = list[float]


class EmbeddingService(ABC):
    """Provider-independent embedding interface.

    Document chunks and user queries must live in the same retrieval space.
    Providers that use asymmetric encoding (e.g. EmbeddingGemma) override
    embed_query / embed_documents; others may share one encode path.
    """

    @property
    @abstractmethod
    def provider(self) -> str:
        """Configured provider id (e.g. openai, sentence_transformers, deterministic)."""

    @property
    @abstractmethod
    def model(self) -> str:
        """Configured model id — stored alongside each embedding."""

    @property
    def dimension(self) -> int | None:
        """Expected output dimension when known; None if unconstrained."""
        return None

    @abstractmethod
    async def embed_text(self, text: str) -> EmbeddingVector:
        """Embed a single string (document-oriented by default)."""

    @abstractmethod
    async def embed_texts(self, texts: list[str]) -> list[EmbeddingVector]:
        """Batch embed documents; implementations may fall back to sequential calls."""

    async def embed_documents(self, texts: list[str]) -> list[EmbeddingVector]:
        """Document / textbox-chunk embeddings (batch)."""
        return await self.embed_texts(texts)

    async def embed_document(self, text: str) -> EmbeddingVector:
        vectors = await self.embed_documents([text])
        return vectors[0]

    async def embed_query(self, text: str) -> EmbeddingVector:
        """User-prompt / retrieval-query embedding."""
        return await self.embed_text(text)

    async def embed_queries(self, texts: list[str]) -> list[EmbeddingVector]:
        """Batch query embeddings (e.g. multi-chunk long prompts)."""
        if not texts:
            return []
        return [await self.embed_query(t) for t in texts]

    def is_loaded(self) -> bool:
        """Whether a heavy model is already resident in memory."""
        return True
