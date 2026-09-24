from __future__ import annotations

from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..errors import AiServiceError
from .embeddings.base import EmbeddingService
from .embeddings.factory import build_embedding_service
from .query_processor import QueryChunk, process_prompt
from .ranking import ElementCandidate, group_chunks_by_element, rank_chunks_by_similarity
from .repository import RagChunkRepository
from .schemas import (
    MatchedChunkResponse,
    RetrieveRequest,
    RetrieveResponse,
    RetrievedElementResponse,
)


class PromptRetrievalService:
    """Semantic-only retrieval: prompt → embed → cosine → group by element.

    Geometry is returned but never used for ranking in this phase.
    """

    def __init__(
        self,
        session: Session,
        settings: Settings | None = None,
        embedding: EmbeddingService | None = None,
    ) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.repo = RagChunkRepository(session)
        self.embedding = embedding

    def _require_embedding(self) -> EmbeddingService:
        if self.embedding is not None:
            return self.embedding
        return build_embedding_service(self.settings)

    async def retrieve(self, request: RetrieveRequest) -> RetrieveResponse:
        prompt = request.prompt.strip()
        if not prompt:
            raise AiServiceError(
                "Prompt cannot be empty.",
                code="invalid_prompt",
                status_code=422,
            )

        embedder = self._require_embedding()
        query_chunks = process_prompt(
            prompt,
            long_threshold=self.settings.query_long_prompt_threshold_words,
            target_words=self.settings.query_target_chunk_words,
            overlap_words=self.settings.query_chunk_overlap_words,
        )
        if not query_chunks:
            raise AiServiceError(
                "Prompt cannot be empty.",
                code="invalid_prompt",
                status_code=422,
            )

        query_vectors = await embedder.embed_queries([c.text for c in query_chunks])

        rows = self.repo.list_embedded_for_board(
            request.board_id,
            embedding_model=embedder.model,
        )

        top_k = request.top_k if request.top_k is not None else self.settings.rag_chunk_top_k
        min_sim = (
            request.min_similarity
            if request.min_similarity is not None
            else self.settings.rag_min_similarity
        )

        chunk_matches = rank_chunks_by_similarity(
            query_vectors,
            rows,
            metric=self.settings.rag_similarity_metric,
            top_k=top_k,
            min_similarity=min_sim,
        )
        candidates = group_chunks_by_element(chunk_matches)

        return RetrieveResponse(
            board_id=request.board_id,
            query_chunks=len(query_chunks),
            query_chunk_texts=[c.text for c in query_chunks],
            embedding_model=embedder.model,
            embedding_provider=embedder.provider,
            similarity_metric=self.settings.rag_similarity_metric,
            top_k=top_k,
            min_similarity=min_sim,
            candidates=[
                RetrievedElementResponse(
                    element_id=c.element_id,
                    element_type=c.element_type,
                    score=c.score,
                    matched_chunks=[
                        MatchedChunkResponse(
                            chunk_id=m.chunk_id,
                            chunk_index=m.chunk_index,
                            text=m.text,
                            similarity=m.similarity,
                        )
                        for m in c.matched_chunks
                    ],
                    geometry=c.geometry,
                )
                for c in candidates
            ],
        )
