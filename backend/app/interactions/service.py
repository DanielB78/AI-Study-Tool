from __future__ import annotations

from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db.models import AiInteraction
from ..errors import AiServiceError
from ..rag.embeddings.base import EmbeddingService
from ..rag.embeddings.factory import build_embedding_service
from .document import build_interaction_embedding_document, interaction_content_hash
from .repository import AiInteractionRepository
from .schemas import (
    InteractionCreateRequest,
    InteractionRecordResponse,
    InteractionStatus,
    InteractionView,
    RebuildInteractionEmbeddingsResponse,
)
from .summary import summarize_operations


def _to_view(row: AiInteraction) -> InteractionView:
    return InteractionView(
        id=str(row.id),
        board_id=row.board_id,
        user_prompt=row.user_prompt,
        action_summary=row.action_summary,
        transaction_id=row.transaction_id,
        affected_element_ids=list(row.affected_element_ids or []),
        created_element_ids=list(row.created_element_ids or []),
        updated_element_ids=list(row.updated_element_ids or []),
        status=row.status,  # type: ignore[arg-type]
        has_embedding=row.embedding is not None,
        embedding_model=row.embedding_model,
        content_hash=row.content_hash,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


class InteractionMemoryService:
    """Record AI interactions and maintain optional semantic embeddings."""

    def __init__(
        self,
        session: Session,
        settings: Settings | None = None,
        embedding: EmbeddingService | None = None,
    ) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.repo = AiInteractionRepository(session)
        self._embedding = embedding

    def _try_embedding(self) -> EmbeddingService | None:
        if self._embedding is not None:
            return self._embedding
        if not self.settings.has_embedding_config:
            return None
        return build_embedding_service(self.settings)

    async def record_interaction(
        self,
        payload: InteractionCreateRequest,
    ) -> InteractionRecordResponse:
        """Persist an applied interaction; embed when a provider is configured."""
        summary = (payload.action_summary or "").strip()
        if not summary:
            summary = summarize_operations(
                payload.user_prompt,
                payload.operations,
                element_previews=payload.element_previews,
                created_ids=payload.created_element_ids,
            )

        digest = interaction_content_hash(payload.user_prompt, summary)
        doc = build_interaction_embedding_document(payload.user_prompt, summary)

        embedder = self._try_embedding()
        vector = None
        model = None
        provider = None
        if embedder is not None:
            vectors = await embedder.embed_documents([doc])
            vector = vectors[0]
            model = embedder.model
            provider = embedder.provider

        try:
            row = self.repo.create(
                board_id=payload.board_id,
                user_prompt=payload.user_prompt,
                action_summary=summary,
                transaction_id=payload.transaction_id,
                affected_element_ids=payload.affected_element_ids,
                created_element_ids=payload.created_element_ids,
                updated_element_ids=payload.updated_element_ids,
                operations_json=payload.operations,
                status="applied",
                embedding=vector,
                embedding_model=model,
                embedding_provider=provider,
                content_hash=digest,
            )
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

        return InteractionRecordResponse(
            id=str(row.id),
            board_id=row.board_id,
            transaction_id=row.transaction_id,
            action_summary=row.action_summary,
            status=row.status,  # type: ignore[arg-type]
            embeddings_written=vector is not None,
            embedding_model=model,
        )

    async def rebuild_embeddings_for_board(
        self,
        board_id: str,
    ) -> RebuildInteractionEmbeddingsResponse:
        embedder = self._try_embedding()
        if embedder is None:
            raise AiServiceError(
                "Embedding is not configured. Set EMBEDDING_PROVIDER and EMBEDDING_MODEL.",
                code="missing_embedding_config",
                status_code=503,
            )
        rows = self.repo.list_for_board(board_id)
        if not rows:
            return RebuildInteractionEmbeddingsResponse(
                board_id=board_id,
                interaction_count=0,
                embeddings_written=0,
                embedding_model=embedder.model,
            )
        docs = [
            build_interaction_embedding_document(row.user_prompt, row.action_summary)
            for row in rows
        ]
        try:
            vectors = await embedder.embed_documents(docs)
            for row, vector in zip(rows, vectors, strict=True):
                digest = interaction_content_hash(row.user_prompt, row.action_summary)
                self.repo.update_embedding(
                    row,
                    vector,
                    embedding_model=embedder.model,
                    embedding_provider=embedder.provider,
                    content_hash=digest,
                )
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        return RebuildInteractionEmbeddingsResponse(
            board_id=board_id,
            interaction_count=len(rows),
            embeddings_written=len(rows),
            embedding_model=embedder.model,
        )

    def set_status_by_transaction(
        self,
        board_id: str,
        transaction_id: str,
        status: InteractionStatus,
    ) -> InteractionView:
        row = self.repo.update_status_by_transaction(board_id, transaction_id, status)
        if row is None:
            raise AiServiceError(
                f"No interaction found for transaction '{transaction_id}'.",
                code="interaction_not_found",
                status_code=404,
            )
        try:
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise
        return _to_view(row)

    def list_recent(self, board_id: str, limit: int | None = None) -> list[InteractionView]:
        cap = (
            limit
            if limit is not None
            else self.settings.recent_interaction_count
        )
        rows = self.repo.list_recent_for_board(board_id, limit=cap)
        return [_to_view(row) for row in rows]
