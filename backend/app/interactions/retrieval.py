from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db.models import AiInteraction
from ..errors import AiServiceError
from ..rag.embeddings.base import EmbeddingService, EmbeddingVector
from ..rag.embeddings.factory import build_embedding_service
from ..rag.similarity import similarity
from .repository import AiInteractionRepository, interaction_embedding_as_list
from .schemas import (
    InteractionRetrieveRequest,
    InteractionRetrieveResponse,
    InteractionView,
)


@dataclass
class _ScoredInteraction:
    row: AiInteraction
    similarity: float


def _to_view(
    row: AiInteraction,
    *,
    provenance: str,
    score: float | None = None,
) -> InteractionView:
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
        similarity=score,
        provenance=provenance,  # type: ignore[arg-type]
    )


class InteractionRetrievalService:
    """Hybrid recent-window + semantic retrieval over AI interactions."""

    def __init__(
        self,
        session: Session,
        settings: Settings | None = None,
        embedding: EmbeddingService | None = None,
    ) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.repo = AiInteractionRepository(session)
        self.embedding = embedding

    def _require_embedding(self) -> EmbeddingService:
        if self.embedding is not None:
            return self.embedding
        return build_embedding_service(self.settings)

    def _try_embedding(self) -> EmbeddingService | None:
        if self.embedding is not None:
            return self.embedding
        if not self.settings.has_embedding_config:
            return None
        return build_embedding_service(self.settings)

    async def retrieve(
        self,
        board_id: str,
        prompt: str,
        *,
        recent_count: int | None = None,
        top_k: int | None = None,
        min_similarity: float | None = None,
        selected_historical_ids: list[str] | None = None,
    ) -> InteractionRetrieveResponse:
        cleaned = (prompt or "").strip()
        if not cleaned:
            raise AiServiceError(
                "Prompt cannot be empty.",
                code="invalid_prompt",
                status_code=422,
            )

        recent_n = (
            recent_count
            if recent_count is not None
            else self.settings.recent_interaction_count
        )
        k = top_k if top_k is not None else self.settings.interaction_rag_top_k
        min_sim = (
            min_similarity
            if min_similarity is not None
            else self.settings.interaction_rag_min_similarity
        )

        recent_rows = self.repo.list_recent_for_board(board_id, limit=recent_n)
        recent_ids = {str(row.id) for row in recent_rows}
        recent_views = [
            _to_view(row, provenance="recent") for row in recent_rows
        ]

        historical_views: list[InteractionView] = []
        embedder = self._try_embedding()
        model = embedder.model if embedder else None
        provider = embedder.provider if embedder else None

        # Explicitly selected older interactions (by id), excluding recent dupes.
        selected_rows: list[AiInteraction] = []
        if selected_historical_ids:
            selected_rows = self.repo.get_by_ids(board_id, selected_historical_ids)
            for row in selected_rows:
                if str(row.id) in recent_ids:
                    continue
                historical_views.append(
                    _to_view(row, provenance="selected", score=None)
                )

        selected_ids = {str(row.id) for row in selected_rows}

        if embedder is not None and k > 0:
            query_vec = await embedder.embed_query(cleaned)
            candidates = self.repo.list_embedded_for_board(
                board_id, embedding_model=embedder.model
            )
            scored = self._rank(
                query_vec,
                candidates,
                exclude_ids=recent_ids | selected_ids,
                top_k=k,
                min_similarity=min_sim,
            )
            for item in scored:
                historical_views.append(
                    _to_view(
                        item.row,
                        provenance="historical",
                        score=item.similarity,
                    )
                )

        # Deduplicate historical by id (selected first, then semantic).
        seen: set[str] = set()
        deduped: list[InteractionView] = []
        for view in historical_views:
            if view.id in seen or view.id in recent_ids:
                continue
            seen.add(view.id)
            deduped.append(view)

        return InteractionRetrieveResponse(
            board_id=board_id,
            recent=recent_views,
            historical=deduped,
            embedding_model=model,
            embedding_provider=provider,
            recent_count=recent_n,
            top_k=k,
            min_similarity=min_sim,
        )

    async def retrieve_request(
        self,
        board_id: str,
        request: InteractionRetrieveRequest,
    ) -> InteractionRetrieveResponse:
        return await self.retrieve(
            board_id,
            request.prompt,
            recent_count=request.recent_count,
            top_k=request.top_k,
            min_similarity=request.min_similarity,
            selected_historical_ids=request.selected_historical_ids,
        )

    def _rank(
        self,
        query_vec: EmbeddingVector,
        rows: list[AiInteraction],
        *,
        exclude_ids: set[str],
        top_k: int,
        min_similarity: float | None,
    ) -> list[_ScoredInteraction]:
        metric = self.settings.effective_similarity_metric
        scored: list[_ScoredInteraction] = []
        for row in rows:
            if str(row.id) in exclude_ids:
                continue
            doc_vec = interaction_embedding_as_list(row.embedding)
            if doc_vec is None:
                continue
            score = similarity(query_vec, doc_vec, metric=metric)
            if min_similarity is not None and score < min_similarity:
                continue
            scored.append(_ScoredInteraction(row=row, similarity=score))
        scored.sort(key=lambda s: s.similarity, reverse=True)
        if top_k > 0:
            scored = scored[:top_k]
        return scored
