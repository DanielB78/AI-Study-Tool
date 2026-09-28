from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Backend configuration loaded from environment variables / .env."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_base_url: str = "https://api.openai.com/v1"
    llm_timeout_seconds: float = 60.0
    # "openai" (default) or "mock" for local UI testing without a paid key.
    llm_provider: str = "openai"
    # Comma-separated origins for local Vite / future web clients.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # PostgreSQL (Supabase-compatible). Required for RAG indexing routes.
    database_url: str = ""

    # Chunking knobs (tunable without code scatter).
    rag_short_text_threshold: int = 100
    rag_target_chunk_words: int = 75
    rag_chunk_overlap_words: int = 15

    # Embedding configuration — intentionally NO default model.
    # Recommended local setup:
    #   EMBEDDING_PROVIDER=sentence_transformers
    #   EMBEDDING_MODEL=google/embeddinggemma-300m
    #   EMBEDDING_DIMENSION=768
    #   EMBEDDING_SIMILARITY=cosine
    embedding_provider: str = ""
    embedding_model: str = ""
    embedding_dimension: int | None = None
    # Similarity metric for embeddings (kept in sync with RAG scoring).
    embedding_similarity: str = "cosine"
    # SentenceTransformers batch size for document encoding.
    embedding_batch_size: int = 32
    # Optional device override: "cpu", "cuda", "mps". Empty = auto.
    embedding_device: str = ""

    # Hugging Face auth for gated models (EmbeddingGemma). Never commit secrets.
    hf_token: str = ""
    huggingface_hub_token: str = ""

    # Retrieval (semantic-only). min_similarity has NO default — leave unset.
    rag_chunk_top_k: int = 20
    rag_min_similarity: float | None = None
    rag_similarity_metric: str = "cosine"

    # Query / prompt processing.
    query_long_prompt_threshold_words: int = 200
    query_target_chunk_words: int = 125
    query_chunk_overlap_words: int = 20

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def has_openai_api_key(self) -> bool:
        return bool(self.openai_api_key.strip())

    @property
    def is_mock_provider(self) -> bool:
        return self.llm_provider.strip().lower() == "mock"

    @property
    def has_database_url(self) -> bool:
        return bool(self.database_url.strip())

    @property
    def has_embedding_config(self) -> bool:
        return bool(self.embedding_provider.strip() and self.embedding_model.strip())

    @property
    def resolved_hf_token(self) -> str:
        """HF token from HF_TOKEN or HUGGINGFACE_HUB_TOKEN (never log this)."""
        return (self.hf_token or self.huggingface_hub_token or "").strip()

    @property
    def has_hf_token(self) -> bool:
        return bool(self.resolved_hf_token)

    @property
    def effective_similarity_metric(self) -> str:
        """Prefer EMBEDDING_SIMILARITY when set; fall back to RAG_SIMILARITY_METRIC."""
        emb = (self.embedding_similarity or "").strip().lower()
        if emb:
            return emb
        return (self.rag_similarity_metric or "cosine").strip().lower() or "cosine"


@lru_cache
def get_settings() -> Settings:
    return Settings()
