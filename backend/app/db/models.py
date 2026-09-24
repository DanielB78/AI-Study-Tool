from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class RagChunk(Base):
    """Indexed text chunk derived from a canvas TextElement.

    Embeddings will be added in a later migration after a model is chosen.
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

    # Optional provenance / future fields (not required for rendering).
    element_revision: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # JSONB keeps us Supabase/Postgres friendly without picking embedding dims.
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
