from __future__ import annotations

from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..errors import AiServiceError
from .embeddings.base import EmbeddingService
from .embeddings.factory import build_embedding_service
from .intent.classifier import EmbeddingPromptIntentClassifier
from .intent.types import PromptIntentClassification
from .query_processor import QueryChunk, process_prompt
from .ranking import ElementCandidate, group_chunks_by_element, rank_chunks_by_similarity
from .repository import RagChunkRepository
from .schemas import (
    MatchedChunkResponse,
    PromptIntentClassificationResponse,
    PromptIntentExemplarMatchResponse,
    PromptIntentScoreResponse,
    RetrieveRequest,
    RetrieveResponse,
    RetrievedElementResponse,
)


def _classification_to_response(
    result: PromptIntentClassification,
) -> PromptIntentClassificationResponse:
    return PromptIntentClassificationResponse(
        classified_intent=result.classified_intent.value,
        scores=[
            PromptIntentScoreResponse(
                intent=s.intent.value,
                similarity=s.similarity,
                display_name=s.display_name,
                top_matches=[
                    PromptIntentExemplarMatchResponse(
                        text=m.text,
                        similarity=m.similarity,
                    )
                    for m in s.top_matches
                ],
            )
            for s in result.scores
        ],
        top_score=result.top_score,
        second_score=result.second_score,
        score_margin=result.score_margin,
        embedding_model=result.embedding_model,
        embedding_provider=result.embedding_provider,
        exemplar_top_k=result.exemplar_top_k,
    )


class PromptRetrievalService:
    """Semantic-only retrieval: prompt → embed → cosine → group by element.

    Geometry is returned but never used for ranking in this phase.
    Prompt-intent classification is observational and does not alter ranking.
    """

    def __init__(
        self,
        session: Session,
        settings: Settings | None = None,
        embedding: EmbeddingService | None = None,
        intent_classifier: EmbeddingPromptIntentClassifier | None = None,
    ) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.repo = RagChunkRepository(session)
        self.embedding = embedding
        self.intent_classifier = intent_classifier

    def _require_embedding(self) -> EmbeddingService:
        if self.embedding is not None:
            return self.embedding
        return build_embedding_service(self.settings)

    def _require_intent_classifier(
        self, embedder: EmbeddingService
    ) -> EmbeddingPromptIntentClassifier:
        if self.intent_classifier is not None:
            return self.intent_classifier
        return EmbeddingPromptIntentClassifier(embedder)

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

        # Single query-embedding pass shared by canvas retrieval + intent classifier.
        query_vectors = await embedder.embed_queries([c.text for c in query_chunks])

        classifier = self._require_intent_classifier(embedder)
        intent_result = await classifier.classify_from_query_vectors(prompt, query_vectors)

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

        similarity_metric = self.settings.effective_similarity_metric
        chunk_matches = rank_chunks_by_similarity(
            query_vectors,
            rows,
            metric=similarity_metric,
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
            similarity_metric=similarity_metric,
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
            prompt_intent=_classification_to_response(intent_result),
        )
