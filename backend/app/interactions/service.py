from __future__ import annotations

from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db.models import AiInteraction
from ..errors import AiServiceError
from ..rag.embeddings.base import EmbeddingService
from ..rag.embeddings.factory import build_embedding_service
from .document import interaction_content_hash
from .repository import AiInteractionRepository
from .schemas import (
    InteractionCreateRequest,
    InteractionRecordResponse,
    InteractionView,
    RebuildInteractionEmbeddingsResponse,
)


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
        has_prompt_embedding=row.prompt_embedding is not None,
        has_summary_embedding=row.summary_embedding is not None,
        embedding_model=row.embedding_model,
        content_hash=row.content_hash,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


class InteractionMemoryService:
    """Record AI interactions and maintain dual prompt/summary embeddings."""

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
        digest = interaction_content_hash(payload.user_prompt, payload.action_summary)

        embedder = self._try_embedding()
        prompt_vec = None
        summary_vec = None
        model = None
        provider = None
        if embedder is not None:
            # Query encoding for the stored prompt; document encoding for the summary.
            prompt_vecs = await embedder.embed_queries([payload.user_prompt])
            summary_vecs = await embedder.embed_documents([payload.action_summary])
            prompt_vec = prompt_vecs[0]
            summary_vec = summary_vecs[0]
            model = embedder.model
            provider = embedder.provider

        try:
            row = self.repo.create(
                board_id=payload.board_id,
                user_prompt=payload.user_prompt,
                action_summary=payload.action_summary,
                transaction_id=payload.transaction_id,
                affected_element_ids=payload.affected_element_ids,
                created_element_ids=payload.created_element_ids,
                updated_element_ids=payload.updated_element_ids,
                metadata=payload.metadata,
                status="applied",
                prompt_embedding=prompt_vec,
                summary_embedding=summary_vec,
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
            embeddings_written=prompt_vec is not None and summary_vec is not None,
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
        prompts = [row.user_prompt for row in rows]
        summaries = [row.action_summary for row in rows]
        try:
            prompt_vecs = await embedder.embed_queries(prompts)
            summary_vecs = await embedder.embed_documents(summaries)
            written = 0
            for row, pvec, svec in zip(rows, prompt_vecs, summary_vecs, strict=True):
                digest = interaction_content_hash(row.user_prompt, row.action_summary)
                self.repo.update_embeddings(
                    row,
                    prompt_embedding=pvec,
                    summary_embedding=svec,
                    embedding_model=embedder.model,
                    embedding_provider=embedder.provider,
                    content_hash=digest,
                )
                written += 1
            self.session.commit()
        except Exception:
            self.session.rollback()
            raise

        return RebuildInteractionEmbeddingsResponse(
            board_id=board_id,
            interaction_count=len(rows),
            embeddings_written=written,
            embedding_model=embedder.model,
        )
