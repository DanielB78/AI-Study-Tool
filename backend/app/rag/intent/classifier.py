"""Embedding-based prompt-intent classifier (local, no LLM).

Observational only — does not change retrieval policies.

Compares the prompt query embedding to short abstract exemplar fragments
(embedded separately). Intent score = mean of top-K exemplar similarities.

Answers: does this request need a special spatial or interaction-history
interpretation? It does NOT decide how much canvas context to retrieve.
GENERAL means neither special signal was strongest — not element/topic/board scope.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Sequence

from ..embeddings.base import EmbeddingService, EmbeddingVector
from ..embeddings.factory import get_embedding_service
from ..similarity import cosine_similarity
from .prototypes import (
    INTENT_DEFINITIONS,
    INTENT_EXEMPLAR_TOP_K,
    exemplar_content_fingerprint,
)
from .types import (
    PromptIntent,
    PromptIntentClassification,
    PromptIntentExemplarMatch,
    PromptIntentScore,
)

logger = logging.getLogger(__name__)


def _mean_vector(vectors: Sequence[EmbeddingVector]) -> EmbeddingVector:
    if not vectors:
        raise ValueError("cannot average an empty vector list")
    dim = len(vectors[0])
    if dim == 0:
        return []
    acc = [0.0] * dim
    for vec in vectors:
        if len(vec) != dim:
            raise ValueError("query vectors have mismatched dimensions")
        for i, x in enumerate(vec):
            acc[i] += x
    n = float(len(vectors))
    return [x / n for x in acc]


def _mean_top_k(similarities: list[float], k: int) -> float:
    if not similarities:
        return 0.0
    ranked = sorted(similarities, reverse=True)
    take = ranked[: max(1, min(k, len(ranked)))]
    return sum(take) / float(len(take))


class EmbeddingPromptIntentClassifier:
    """Compare a query embedding against cached per-exemplar embeddings."""

    def __init__(
        self,
        embedding: EmbeddingService,
        *,
        top_k: int = INTENT_EXEMPLAR_TOP_K,
    ) -> None:
        self._embedding = embedding
        self._top_k = max(1, top_k)
        self._cache_key: str | None = None
        # intent → list of (exemplar_text, vector) in definition order
        self._exemplar_vectors: dict[
            PromptIntent, list[tuple[str, EmbeddingVector]]
        ] | None = None

    @property
    def embedding(self) -> EmbeddingService:
        return self._embedding

    @property
    def top_k(self) -> int:
        return self._top_k

    def _build_cache_key(self) -> str:
        fingerprint = exemplar_content_fingerprint()
        digest = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:16]
        return f"{self._embedding.provider}:{self._embedding.model}:k{self._top_k}:{digest}"

    async def ensure_exemplars(
        self,
    ) -> dict[PromptIntent, list[tuple[str, EmbeddingVector]]]:
        """Embed every exemplar fragment once; rebuild if model/text changes."""
        key = self._build_cache_key()
        if self._exemplar_vectors is not None and self._cache_key == key:
            return self._exemplar_vectors

        # Flatten all fragments — each is embedded separately (never concatenated).
        flat_texts: list[str] = []
        ownership: list[PromptIntent] = []
        for definition in INTENT_DEFINITIONS:
            for example in definition.examples:
                flat_texts.append(example)
                ownership.append(definition.intent)

        vectors = await self._embedding.embed_documents(flat_texts)
        if len(vectors) != len(flat_texts):
            raise RuntimeError("exemplar embedding count mismatch")

        mapping: dict[PromptIntent, list[tuple[str, EmbeddingVector]]] = {
            d.intent: [] for d in INTENT_DEFINITIONS
        }
        for intent, text, vector in zip(ownership, flat_texts, vectors, strict=True):
            mapping[intent].append((text, vector))

        self._exemplar_vectors = mapping
        self._cache_key = key
        logger.debug(
            "prompt-intent exemplars embedded model=%s intents=%s fragments=%s top_k=%s",
            self._embedding.model,
            len(mapping),
            len(flat_texts),
            self._top_k,
        )
        return mapping

    # Alias kept for call sites / tests that still say "prototypes".
    async def ensure_prototypes(
        self,
    ) -> dict[PromptIntent, list[tuple[str, EmbeddingVector]]]:
        return await self.ensure_exemplars()

    def invalidate_cache(self) -> None:
        self._exemplar_vectors = None
        self._cache_key = None

    async def classify_from_embedding(
        self,
        prompt: str,
        query_embedding: EmbeddingVector,
    ) -> PromptIntentClassification:
        """Classify using an existing query vector (no re-embed of the prompt)."""
        _ = prompt  # retained for API clarity / future logging
        exemplars = await self.ensure_exemplars()

        scored: list[PromptIntentScore] = []
        for definition in INTENT_DEFINITIONS:
            pairs = exemplars[definition.intent]
            matches = [
                PromptIntentExemplarMatch(
                    text=text,
                    similarity=cosine_similarity(query_embedding, vector),
                )
                for text, vector in pairs
            ]
            matches.sort(key=lambda m: m.similarity, reverse=True)
            intent_score = _mean_top_k(
                [m.similarity for m in matches],
                self._top_k,
            )
            scored.append(
                PromptIntentScore(
                    intent=definition.intent,
                    similarity=intent_score,
                    display_name=definition.intent.display_name,
                    top_matches=matches[: self._top_k],
                )
            )

        scored.sort(key=lambda s: s.similarity, reverse=True)
        top = scored[0]
        second = scored[1] if len(scored) > 1 else scored[0]
        margin = top.similarity - second.similarity

        return PromptIntentClassification(
            classified_intent=top.intent,
            scores=scored,
            top_score=top.similarity,
            second_score=second.similarity,
            score_margin=margin,
            embedding_model=self._embedding.model,
            embedding_provider=self._embedding.provider,
            exemplar_top_k=self._top_k,
        )

    async def classify(self, prompt: str) -> PromptIntentClassification:
        """Convenience: embed_query(prompt) then classify."""
        cleaned = prompt.strip()
        if not cleaned:
            raise ValueError("prompt cannot be empty")
        query_vec = await self._embedding.embed_query(cleaned)
        return await self.classify_from_embedding(cleaned, query_vec)

    async def classify_from_query_vectors(
        self,
        prompt: str,
        query_vectors: Sequence[EmbeddingVector],
    ) -> PromptIntentClassification:
        """Reuse retrieval query vectors when available (1 → use it; N → mean)."""
        if not query_vectors:
            return await self.classify(prompt)
        if len(query_vectors) == 1:
            return await self.classify_from_embedding(prompt, query_vectors[0])
        return await self.classify_from_embedding(prompt, _mean_vector(query_vectors))


# Process-wide classifier bound to the shared EmbeddingService singleton.
_classifier: EmbeddingPromptIntentClassifier | None = None
_classifier_service_id: int | None = None


def get_prompt_intent_classifier(
    embedding: EmbeddingService | None = None,
) -> EmbeddingPromptIntentClassifier:
    """Return a classifier for the given (or process-default) embedding service."""
    global _classifier, _classifier_service_id
    service = embedding if embedding is not None else get_embedding_service()
    sid = id(service)
    if _classifier is None or _classifier_service_id != sid:
        _classifier = EmbeddingPromptIntentClassifier(service)
        _classifier_service_id = sid
    return _classifier


def reset_prompt_intent_classifier() -> None:
    """Test helper — drop the process-wide classifier cache."""
    global _classifier, _classifier_service_id
    if _classifier is not None:
        _classifier.invalidate_cache()
    _classifier = None
    _classifier_service_id = None
