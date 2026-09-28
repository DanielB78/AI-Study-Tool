from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from pgvector.sqlalchemy import Vector

from .base import Base


class RagChunk(Base):
    """Indexed text chunk derived from a canvas TextElement.

    Embeddings use pgvector ``vector(768)`` for EmbeddingGemma
    (google/embeddinggemma-300m). Dimension is fixed by migration 0003.
    """

    __tablename__ = "rag_chunks"
    __table_args__ = (
        UniqueConstraint(
            "board_id",
            "element_id",
            "chunk_index",
            name="uq_rag_chunks_board_element_index",
        ),
        Index("ix_rag_chunks_board_id", "board_id"),
        Index("ix_rag_chunks_element_id", "element_id"),
        Index("ix_rag_chunks_board_element", "board_id", "element_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    board_id: Mapped[str] = mapped_column(String(128), nullable=False)
    element_id: Mapped[str] = mapped_column(String(128), nullable=False)
    element_type: Mapped[str] = mapped_column(String(64), nullable=False, default="text")

    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)

    text: Mapped[str] = mapped_column(Text, nullable=False)
    start_char: Mapped[int] = mapped_column(Integer, nullable=False)
    end_char: Mapped[int] = mapped_column(Integer, nullable=False)

    x: Mapped[float] = mapped_column(Float, nullable=False)
    y: Mapped[float] = mapped_column(Float, nullable=False)
    width: Mapped[float] = mapped_column(Float, nullable=False)
    height: Mapped[float] = mapped_column(Float, nullable=False)

    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    # Embedding fields (nullable until embedded with the active model).
    embedding: Mapped[list[float] | None] = mapped_column(Vector(768), nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String(256), nullable=True)
    embedding_provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    embedding_content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    embedding_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Optional provenance / future fields (not required for rendering).
    element_revision: Mapped[str | None] = mapped_column(String(128), nullable=True)
    chunk_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class AiInteraction(Base):
    """Recorded AI canvas interaction for memory / undo provenance.

    Embeddings use the same pgvector ``vector(768)`` space as RagChunk
    (EmbeddingGemma). Embedding fields stay NULL until configured.
    """

    __tablename__ = "ai_interactions"
    __table_args__ = (
        Index("ix_ai_interactions_board_id", "board_id"),
        Index("ix_ai_interactions_transaction_id", "transaction_id"),
        Index("ix_ai_interactions_board_created_at", "board_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    board_id: Mapped[str] = mapped_column(String(128), nullable=False)
    user_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    action_summary: Mapped[str] = mapped_column(Text, nullable=False)
    transaction_id: Mapped[str] = mapped_column(String(128), nullable=False)

    affected_element_ids: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list
    )
    created_element_ids: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list
    )
    updated_element_ids: Mapped[list] = mapped_column(
        JSONB, nullable=False, default=list
    )
    operations_json: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    status: Mapped[str] = mapped_column(String(32), nullable=False, default="applied")

    embedding: Mapped[list[float] | None] = mapped_column(Vector(768), nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String(256), nullable=True)
    embedding_provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
