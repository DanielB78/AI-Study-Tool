"""Optional real EmbeddingGemma integration for 2-way intent classification.

Enable with: RUN_EMBEDDINGGEMMA_TESTS=1
"""

from __future__ import annotations

import os

import pytest

from app.config import Settings
from app.rag.embeddings.factory import build_embedding_service, reset_embedding_service_cache
from app.rag.intent.classifier import EmbeddingPromptIntentClassifier, reset_prompt_intent_classifier
from app.rag.intent.prototypes import get_intent_definition
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


@pytest.mark.asyncio
async def test_gemma_two_way_special_intents(
    classifier: EmbeddingPromptIntentClassifier,
) -> None:
    cases: list[tuple[str, PromptIntent]] = [
        ("What is around this?", PromptIntent.SPATIAL_RELATIONAL),
        ("Can you move this to the right?", PromptIntent.SPATIAL_RELATIONAL),
        ("Change the one you just made.", PromptIntent.INTERACTION_REFERENCE),
        ("Undo what you did.", PromptIntent.INTERACTION_REFERENCE),
    ]
    for prompt, expected in cases:
        result = await classifier.classify(prompt)
        ranking = [
            (s.intent.value, round(s.similarity, 4), [m.text for m in s.top_matches])
            for s in result.scores
        ]
        print(
            f"\nPROMPT: {prompt}\n  winner={result.classified_intent.value} "
            f"margin={result.score_margin:.4f}\n  expected={expected.value}\n"
            f"  ranking={ranking}"
        )
        assert len(result.scores) == 2
        assert result.exemplar_top_k == 3
        assert result.classified_intent is expected
        allowed = set(get_intent_definition(result.classified_intent).examples)
        for match in result.scores[0].top_matches:
            assert match.text in allowed
