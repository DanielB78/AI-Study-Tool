"""Optional real EmbeddingGemma integration for prompt-intent classification.

Enable with: RUN_EMBEDDINGGEMMA_TESTS=1

Exploratory: always asserts structure (5 scores, margin, sorted).
Winner assertions are soft — ambiguous prompts log rankings instead of failing CI.
"""

from __future__ import annotations

import os

import pytest

from app.config import Settings
from app.rag.embeddings.factory import build_embedding_service, reset_embedding_service_cache
from app.rag.intent.classifier import EmbeddingPromptIntentClassifier, reset_prompt_intent_classifier
from app.rag.intent.types import PromptIntent

RUN = os.environ.get("RUN_EMBEDDINGGEMMA_TESTS", "").strip() in {"1", "true", "yes"}


pytestmark = [
    pytest.mark.embeddinggemma,
    pytest.mark.skipif(not RUN, reason="Set RUN_EMBEDDINGGEMMA_TESTS=1 to run"),
]


@pytest.fixture
def classifier() -> EmbeddingPromptIntentClassifier:
    reset_embedding_service_cache()
    reset_prompt_intent_classifier()
    settings = Settings(
        embedding_provider="sentence_transformers",
        embedding_model="google/embeddinggemma-300m",
        embedding_dimension=768,
    )
    svc = build_embedding_service(settings)
    return EmbeddingPromptIntentClassifier(svc)


def _rank(result) -> list[tuple[str, float]]:
    return [(s.intent.value, round(s.similarity, 4)) for s in result.scores]


@pytest.mark.asyncio
async def test_gemma_returns_full_ranking_for_representative_prompts(
    classifier: EmbeddingPromptIntentClassifier,
) -> None:
    cases: list[tuple[str, PromptIntent]] = [
        ("Make the electric flux note shorter.", PromptIntent.ELEMENT_SPECIFIC),
        (
            "Check everything I've written about electricity.",
            PromptIntent.TOPIC_SPECIFIC,
        ),
        ("Summarise this entire canvas.", PromptIntent.BOARD_WIDE),
        (
            "What is written next to the electricity note?",
            PromptIntent.SPATIAL_RELATIONAL,
        ),
        ("Make the one you just created shorter.", PromptIntent.INTERACTION_REFERENCE),
    ]
    for prompt, expected in cases:
        result = await classifier.classify(prompt)
        ranking = _rank(result)
        print(
            f"\nPROMPT: {prompt}\n  winner={result.classified_intent.value} "
            f"margin={result.score_margin:.4f}\n  expected={expected.value}\n"
            f"  ranking={ranking}"
        )
        assert len(result.scores) == 5
        assert result.scores == sorted(
            result.scores, key=lambda s: s.similarity, reverse=True
        )
        assert result.score_margin == pytest.approx(
            result.top_score - result.second_score
        )
        # Soft check: expected should appear in the top two (prototype tuning ongoing).
        top_two = {result.scores[0].intent, result.scores[1].intent}
        assert expected in top_two or result.classified_intent is expected, (
            f"prompt={prompt!r} expected={expected.value} in top-2; ranking={ranking}"
        )
