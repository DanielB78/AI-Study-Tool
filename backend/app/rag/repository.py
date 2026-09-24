from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from ..db.models import RagChunk
from .chunker import TextChunk
from .embeddings.base import EmbeddingVector


class RagChunkRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_for_element(self, board_id: str, element_id: str) -> list[RagChunk]:
        stmt = (
            select(RagChunk)
            .where(RagChunk.board_id == board_id, RagChunk.element_id == element_id)
            .order_by(RagChunk.chunk_index.asc())
        )
        return list(self.session.scalars(stmt).all())

    def list_for_board(self, board_id: str) -> list[RagChunk]:
        stmt = (
            select(RagChunk)
            .where(RagChunk.board_id == board_id)
            .order_by(RagChunk.element_id.asc(), RagChunk.chunk_index.asc())
        )
        return list(self.session.scalars(stmt).all())

    def list_embedded_for_board(
        self,
        board_id: str,
        *,
        embedding_model: str,
    ) -> list[RagChunk]:
        """Chunks eligible for semantic search under the active embedding model."""
        stmt = (
            select(RagChunk)
            .where(
                RagChunk.board_id == board_id,
                RagChunk.embedding.is_not(None),
                RagChunk.embedding_model == embedding_model,
            )
            .order_by(RagChunk.element_id.asc(), RagChunk.chunk_index.asc())
        )
        return list(self.session.scalars(stmt).all())

    def delete_for_element(self, board_id: str, element_id: str) -> int:
        stmt = delete(RagChunk).where(
            RagChunk.board_id == board_id,
            RagChunk.element_id == element_id,
        )
        result = self.session.execute(stmt)
        return int(result.rowcount or 0)

    def delete_for_board(self, board_id: str) -> int:
        stmt = delete(RagChunk).where(RagChunk.board_id == board_id)
        result = self.session.execute(stmt)
        return int(result.rowcount or 0)

    def update_geometry_for_element(
        self,
        board_id: str,
        element_id: str,
        *,
        x: float,
        y: float,
        width: float,
        height: float,
    ) -> int:
        stmt = (
            update(RagChunk)
            .where(RagChunk.board_id == board_id, RagChunk.element_id == element_id)
            .values(x=x, y=y, width=width, height=height)
        )
        result = self.session.execute(stmt)
        return int(result.rowcount or 0)

    def replace_element_chunks(
        self,
        *,
        board_id: str,
        element_id: str,
        element_type: str,
        chunks: Sequence[TextChunk],
        content_hash: str,
        x: float,
        y: float,
        width: float,
        height: float,
        embeddings: Sequence[EmbeddingVector] | None = None,
        embedding_model: str | None = None,
        embedding_provider: str | None = None,
        element_revision: str | None = None,
        metadata: dict | None = None,
    ) -> int:
        """Atomically replace all chunks for an element (caller manages transaction)."""
        self.delete_for_element(board_id, element_id)
        now = datetime.now(timezone.utc)
        rows: list[RagChunk] = []
        for i, chunk in enumerate(chunks):
            vector = embeddings[i] if embeddings is not None else None
            rows.append(
                RagChunk(
                    board_id=board_id,
                    element_id=element_id,
                    element_type=element_type,
                    chunk_index=chunk.chunk_index,
                    text=chunk.text,
                    start_char=chunk.start_char,
                    end_char=chunk.end_char,
                    x=x,
                    y=y,
                    width=width,
                    height=height,
                    content_hash=content_hash,
                    embedding=list(vector) if vector is not None else None,
                    embedding_model=embedding_model if vector is not None else None,
                    embedding_provider=embedding_provider if vector is not None else None,
                    embedding_content_hash=content_hash if vector is not None else None,
                    embedding_updated_at=now if vector is not None else None,
                    element_revision=element_revision,
                    chunk_metadata=metadata,
                )
            )
        if rows:
            self.session.add_all(rows)
        return len(rows)

    def update_embeddings_for_rows(
        self,
        rows: Sequence[RagChunk],
        embeddings: Sequence[EmbeddingVector],
        *,
        embedding_model: str,
        embedding_provider: str,
        content_hash: str,
    ) -> int:
        now = datetime.now(timezone.utc)
        for row, vector in zip(rows, embeddings, strict=True):
            row.embedding = list(vector)
            row.embedding_model = embedding_model
            row.embedding_provider = embedding_provider
            row.embedding_content_hash = content_hash
            row.embedding_updated_at = now
        return len(list(rows))
