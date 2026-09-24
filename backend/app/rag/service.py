from __future__ import annotations

from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..errors import AiServiceError
from .chunker import chunk_text
from .embeddings.base import EmbeddingService
from .embeddings.factory import build_embedding_service
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
    RebuildEmbeddingsResponse,
    TextElementIndexRequest,
)


def _chunks_need_reembed(rows, *, model: str, content_hash_value: str) -> bool:
    if not rows:
        return False
    for row in rows:
        if row.embedding is None:
            return True
        if row.embedding_model != model:
            return True
        if row.embedding_content_hash != content_hash_value:
            return True
    return False


class RagIndexingService:
    """Indexes canvas text elements into PostgreSQL and embeds chunks when configured."""

    def __init__(
        self,
        session: Session,
        settings: Settings | None = None,
        embedding: EmbeddingService | None = None,
    ) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.repo = RagChunkRepository(session)
        self._embedding = embedding

    def _try_embedding(self) -> EmbeddingService | None:
        if self._embedding is not None:
            return self._embedding
        if not self.settings.has_embedding_config:
            return None
        return build_embedding_service(self.settings)

    async def index_text_element(self, payload: TextElementIndexRequest) -> IndexElementResponse:
        text = payload.text
        if not text.strip():
            deleted = self.repo.delete_for_element(payload.board_id, payload.element_id)
            self.session.commit()
            return IndexElementResponse(
                element_id=payload.element_id,
                chunk_count=0,
                content_changed=True,
                embeddings_updated=deleted > 0,
            )

        digest = content_hash(text)
        existing = self.repo.list_for_element(payload.board_id, payload.element_id)
        existing_hash = existing[0].content_hash if existing else None
        embedder = self._try_embedding()

        if existing and existing_hash == digest:
            # Geometry-only change: never re-chunk; optionally backfill stale embeddings.
            self.repo.update_geometry_for_element(
                payload.board_id,
                payload.element_id,
                x=payload.x,
                y=payload.y,
                width=payload.width,
                height=payload.height,
            )
            embeddings_updated = False
            if embedder is not None and _chunks_need_reembed(
                existing, model=embedder.model, content_hash_value=digest
            ):
                vectors = await embedder.embed_texts([row.text for row in existing])
                self.repo.update_embeddings_for_rows(
                    existing,
                    vectors,
                    embedding_model=embedder.model,
                    embedding_provider=embedder.provider,
                    content_hash=digest,
                )
                embeddings_updated = True
            self.session.commit()
            return IndexElementResponse(
                element_id=payload.element_id,
                chunk_count=len(existing),
                content_changed=False,
                embeddings_updated=embeddings_updated,
            )

        chunks = chunk_text(
            text,
            short_threshold=self.settings.rag_short_text_threshold,
            target_words=self.settings.rag_target_chunk_words,
            overlap_words=self.settings.rag_chunk_overlap_words,
        )
        vectors = None
        model = None
        provider = None
        if embedder is not None:
            vectors = await embedder.embed_texts([c.text for c in chunks])
            model = embedder.model
            provider = embedder.provider

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
                embeddings=vectors,
                embedding_model=model,
                embedding_provider=provider,
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
            embeddings_updated=vectors is not None,
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

    async def reindex_board(self, board_id: str, payload: BoardReindexRequest) -> BoardReindexResponse:
        """Replace the board's text index (and embeddings when configured)."""
        embedder = self._try_embedding()
        try:
            self.repo.delete_for_board(board_id)
            total_chunks = 0
            embedded = 0
            for element in payload.elements:
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
                vectors = None
                model = None
                provider = None
                if embedder is not None:
                    vectors = await embedder.embed_texts([c.text for c in chunks])
                    model = embedder.model
                    provider = embedder.provider
                    embedded += len(vectors)
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
                    embeddings=vectors,
                    embedding_model=model,
                    embedding_provider=provider,
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
            embeddings_written=embedded,
        )

    async def rebuild_embeddings_for_board(self, board_id: str) -> RebuildEmbeddingsResponse:
        """Re-embed existing chunks for a board with the active model (no re-chunk)."""
        embedder = self._try_embedding()
        if embedder is None:
            raise AiServiceError(
                "Embedding is not configured. Set EMBEDDING_PROVIDER and EMBEDDING_MODEL.",
                code="missing_embedding_config",
                status_code=503,
            )
        rows = self.repo.list_for_board(board_id)
        if not rows:
            return RebuildEmbeddingsResponse(
                board_id=board_id,
                chunk_count=0,
                embeddings_written=0,
                embedding_model=embedder.model,
            )
        try:
            vectors = await embedder.embed_texts([row.text for row in rows])
            # Group by element for content_hash from each row.
            for row, vector in zip(rows, vectors, strict=True):
                self.repo.update_embeddings_for_rows(
                    [row],
                    [vector],
                    embedding_model=embedder.model,
                    embedding_provider=embedder.provider,
                    content_hash=row.content_hash,
                )
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        return RebuildEmbeddingsResponse(
            board_id=board_id,
            chunk_count=len(rows),
            embeddings_written=len(rows),
            embedding_model=embedder.model,
        )

    async def rebuild_embeddings_for_element(
        self,
        board_id: str,
        element_id: str,
    ) -> RebuildEmbeddingsResponse:
        embedder = self._try_embedding()
        if embedder is None:
            raise AiServiceError(
                "Embedding is not configured. Set EMBEDDING_PROVIDER and EMBEDDING_MODEL.",
                code="missing_embedding_config",
                status_code=503,
            )
        rows = self.repo.list_for_element(board_id, element_id)
        if not rows:
            return RebuildEmbeddingsResponse(
                board_id=board_id,
                chunk_count=0,
                embeddings_written=0,
                embedding_model=embedder.model,
            )
        try:
            vectors = await embedder.embed_texts([row.text for row in rows])
            self.repo.update_embeddings_for_rows(
                rows,
                vectors,
                embedding_model=embedder.model,
                embedding_provider=embedder.provider,
                content_hash=rows[0].content_hash,
            )
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        return RebuildEmbeddingsResponse(
            board_id=board_id,
            chunk_count=len(rows),
            embeddings_written=len(rows),
            embedding_model=embedder.model,
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
                has_embedding=row.embedding is not None,
                embedding_model=row.embedding_model,
            )
            for row in rows
        ]
