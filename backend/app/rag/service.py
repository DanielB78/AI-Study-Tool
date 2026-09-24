from __future__ import annotations

from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from .chunker import chunk_text
from .hashing import content_hash
from .repository import RagChunkRepository
from .schemas import (
    BoardReindexRequest,
    BoardReindexResponse,
    DeleteElementResponse,
    GeometryUpdateRequest,
    GeometryUpdateResponse,
    IndexElementResponse,
    RagChunkView,
    TextElementIndexRequest,
)


class RagIndexingService:
    """Indexes canvas text elements into PostgreSQL without embeddings."""

    def __init__(self, session: Session, settings: Settings | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.repo = RagChunkRepository(session)

    def index_text_element(self, payload: TextElementIndexRequest) -> IndexElementResponse:
        text = payload.text
        if not text.strip():
            deleted = self.repo.delete_for_element(payload.board_id, payload.element_id)
            self.session.commit()
            return IndexElementResponse(
                element_id=payload.element_id,
                chunk_count=0,
            content_changed=True,
        )

        digest = content_hash(text)
        existing = self.repo.list_for_element(payload.board_id, payload.element_id)
        existing_hash = existing[0].content_hash if existing else None

        if existing and existing_hash == digest:
            # Geometry-only change: update coords, keep chunk text/hashes.
            updated = self.repo.update_geometry_for_element(
                payload.board_id,
                payload.element_id,
                x=payload.x,
                y=payload.y,
                width=payload.width,
                height=payload.height,
            )
            self.session.commit()
            return IndexElementResponse(
                element_id=payload.element_id,
                chunk_count=len(existing) if updated or existing else 0,
                content_changed=False,
            )

        chunks = chunk_text(
            text,
            short_threshold=self.settings.rag_short_text_threshold,
            target_words=self.settings.rag_target_chunk_words,
            overlap_words=self.settings.rag_chunk_overlap_words,
        )
        try:
            count = self.repo.replace_element_chunks(
                board_id=payload.board_id,
                element_id=payload.element_id,
                element_type=payload.element_type,
                chunks=chunks,
                content_hash=digest,
                x=payload.x,
                y=payload.y,
                width=payload.width,
                height=payload.height,
                element_revision=payload.element_revision,
                metadata=payload.metadata,
            )
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

        return IndexElementResponse(
            element_id=payload.element_id,
            chunk_count=count,
            content_changed=True,
        )

    def update_geometry(
        self,
        board_id: str,
        element_id: str,
        payload: GeometryUpdateRequest,
    ) -> GeometryUpdateResponse:
        updated = self.repo.update_geometry_for_element(
            board_id,
            element_id,
            x=payload.x,
            y=payload.y,
            width=payload.width,
            height=payload.height,
        )
        self.session.commit()
        return GeometryUpdateResponse(element_id=element_id, updated=updated)

    def delete_element(self, board_id: str, element_id: str) -> DeleteElementResponse:
        deleted = self.repo.delete_for_element(board_id, element_id)
        self.session.commit()
        return DeleteElementResponse(element_id=element_id, deleted=deleted)

    def delete_board(self, board_id: str) -> int:
        deleted = self.repo.delete_for_board(board_id)
        self.session.commit()
        return deleted

    def reindex_board(self, board_id: str, payload: BoardReindexRequest) -> BoardReindexResponse:
        """Replace the board's text index with the supplied elements."""
        try:
            self.repo.delete_for_board(board_id)
            total_chunks = 0
            for element in payload.elements:
                # Force board_id from path for consistency.
                body = element.model_copy(update={"board_id": board_id})
                if not body.text.strip():
                    continue
                digest = content_hash(body.text)
                chunks = chunk_text(
                    body.text,
                    short_threshold=self.settings.rag_short_text_threshold,
                    target_words=self.settings.rag_target_chunk_words,
                    overlap_words=self.settings.rag_chunk_overlap_words,
                )
                total_chunks += self.repo.replace_element_chunks(
                    board_id=board_id,
                    element_id=body.element_id,
                    element_type=body.element_type,
                    chunks=chunks,
                    content_hash=digest,
                    x=body.x,
                    y=body.y,
                    width=body.width,
                    height=body.height,
                    element_revision=body.element_revision,
                    metadata=body.metadata,
                )
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

        return BoardReindexResponse(
            board_id=board_id,
            element_count=len([e for e in payload.elements if e.text.strip()]),
            chunk_count=total_chunks,
        )

    def list_board_chunks(self, board_id: str) -> list[RagChunkView]:
        rows = self.repo.list_for_board(board_id)
        return [
            RagChunkView(
                id=str(row.id),
                element_id=row.element_id,
                element_type=row.element_type,
                chunk_index=row.chunk_index,
                text=row.text,
                start_char=row.start_char,
                end_char=row.end_char,
                x=row.x,
                y=row.y,
                width=row.width,
                height=row.height,
                content_hash=row.content_hash,
            )
            for row in rows
        ]
