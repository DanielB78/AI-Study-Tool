from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from ..db.models import RagChunk
from .chunker import TextChunk


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
        element_revision: str | None = None,
        metadata: dict | None = None,
    ) -> int:
        """Atomically replace all chunks for an element (caller manages transaction)."""
        self.delete_for_element(board_id, element_id)
        rows: list[RagChunk] = []
        for chunk in chunks:
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
                    element_revision=element_revision,
                    chunk_metadata=metadata,
                )
            )
        if rows:
            self.session.add_all(rows)
        return len(rows)
