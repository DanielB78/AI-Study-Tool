from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db.models import AiInteraction
from ..errors import AiServiceError
from ..rag.embeddings.base import EmbeddingService, EmbeddingVector
from ..rag.embeddings.factory import build_embedding_service
from ..rag.similarity import similarity
from .repository import AiInteractionRepository
from .schemas import (
    InteractionRetrieveRequest,
    InteractionRetrieveResponse,
    InteractionView,
    MatchedField,
)


@dataclass
class _ScoredInteraction:
    row: AiInteraction
    score: float
    prompt_similarity: float
    summary_similarity: float
    matched_field: MatchedField


def _embedding_as_list(value: object | None) -> EmbeddingVector | None:
    if value is None:
        return None
    return [float(x) for x in value]  # type: ignore[arg-type]


def _to_view(
    row: AiInteraction,
    *,
    score: float | None = None,
    prompt_similarity: float | None = None,
    summary_similarity: float | None = None,
    matched_field: MatchedField | None = None,
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
        has_prompt_embedding=row.prompt_embedding is not None,
        has_summary_embedding=row.summary_embedding is not None,
        embedding_model=row.embedding_model,
        content_hash=row.content_hash,
        created_at=row.created_at,
        updated_at=row.updated_at,
        similarity=score,
        prompt_similarity=prompt_similarity,
        summary_similarity=summary_similarity,
        matched_field=matched_field,
    )


class InteractionRetrievalService:
    """Top-k cosine retrieval over prompt and summary embeddings.

    Per memory: score = max(sim(query, prompt_emb), sim(query, summary_emb)).
    """

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
        if not self.settings.has_embedding_config:
            raise AiServiceError(
                "Embedding is not configured. Set EMBEDDING_PROVIDER and EMBEDDING_MODEL.",
                code="missing_embedding_config",
                status_code=503,
            )
        return build_embedding_service(self.settings)

    async def retrieve(
        self,
        board_id: str,
        prompt: str,
        *,
        top_k: int | None = None,
        min_similarity: float | None = None,
    ) -> InteractionRetrieveResponse:
        cleaned = (prompt or "").strip()
        if not cleaned:
            raise AiServiceError(
                "Prompt cannot be empty.",
                code="invalid_prompt",
                status_code=422,
            )

        k = top_k if top_k is not None else self.settings.interaction_rag_top_k
        min_sim = (
            min_similarity
            if min_similarity is not None
            else self.settings.interaction_rag_min_similarity
        )
        metric = self.settings.effective_similarity_metric

        embedder = self._require_embedding()
        query_vec = await embedder.embed_query(cleaned)
        rows = self.repo.list_embedded_for_board(
            board_id, embedding_model=embedder.model
        )

        scored: list[_ScoredInteraction] = []
        for row in rows:
            prompt_emb = _embedding_as_list(row.prompt_embedding)
            summary_emb = _embedding_as_list(row.summary_embedding)
            if prompt_emb is None or summary_emb is None:
                continue
            prompt_sim = similarity(query_vec, prompt_emb, metric=metric)
            summary_sim = similarity(query_vec, summary_emb, metric=metric)
            score = max(prompt_sim, summary_sim)
            if min_sim is not None and score < min_sim:
                continue
            if prompt_sim >= summary_sim and abs(prompt_sim - summary_sim) < 1e-9:
                matched: MatchedField = "both"
            elif prompt_sim > summary_sim:
                matched = "prompt"
            else:
                matched = "summary"
            # Treat near-ties as "both".
            if abs(prompt_sim - summary_sim) < 1e-6:
                matched = "both"
            scored.append(
                _ScoredInteraction(
                    row=row,
                    score=score,
                    prompt_similarity=prompt_sim,
                    summary_similarity=summary_sim,
                    matched_field=matched,
                )
            )

        scored.sort(key=lambda s: s.score, reverse=True)
        top = scored[:k]
        matches = [
            _to_view(
                item.row,
                score=item.score,
                prompt_similarity=item.prompt_similarity,
                summary_similarity=item.summary_similarity,
                matched_field=item.matched_field,
            )
            for item in top
        ]

        return InteractionRetrieveResponse(
            board_id=board_id,
            matches=matches,
            embedding_model=embedder.model,
            embedding_provider=embedder.provider,
            top_k=k,
            min_similarity=min_sim,
        )

    async def retrieve_request(
        self,
        board_id: str,
        body: InteractionRetrieveRequest,
    ) -> InteractionRetrieveResponse:
        return await self.retrieve(
            board_id,
            body.prompt,
            top_k=body.top_k,
            min_similarity=body.min_similarity,
        )
