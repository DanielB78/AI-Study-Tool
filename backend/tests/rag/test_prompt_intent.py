"""Unit tests for 2-way exemplar-based EmbeddingPromptIntentClassifier."""

from __future__ import annotations

import pytest

from app.rag.embeddings.base import EmbeddingService, EmbeddingVector
from app.rag.intent.classifier import (
    EmbeddingPromptIntentClassifier,
    reset_prompt_intent_classifier,
)
from app.rag.intent.prototypes import (
    INTENT_DEFINITIONS,
    INTENT_EXEMPLAR_TOP_K,
    get_intent_definition,
)
from app.rag.intent.types import PromptIntent


DIM = 32


class IntentAwareFakeEmbedding(EmbeddingService):
    """Maps abstract exemplar fragments and keyword prompts to basis vectors."""

    def __init__(self, dimension: int = DIM, model: str = "fake-intent-v1") -> None:
        self._dimension = dimension
        self._model = model
        self.document_calls = 0
        self.document_batch_sizes: list[int] = []
        self.query_calls = 0
        self._axes = {
            PromptIntent.SPATIAL_RELATIONAL: 0,
            PromptIntent.INTERACTION_REFERENCE: 1,
        }
        self._example_to_intent: dict[str, PromptIntent] = {}
        for definition in INTENT_DEFINITIONS:
            for example in definition.examples:
                self._example_to_intent[example] = definition.intent

    @property
    def provider(self) -> str:
        return "fake_intent"

    @property
    def model(self) -> str:
        return self._model

    @property
    def dimension(self) -> int | None:
        return self._dimension

    def _unit(self, axis: int, weight: float = 1.0) -> EmbeddingVector:
        v = [0.0] * self._dimension
        v[axis] = weight
        return v

    def _for_intent(self, intent: PromptIntent, weight: float = 1.0) -> EmbeddingVector:
        return self._unit(self._axes[intent], weight)

    def _classify_text(self, text: str) -> EmbeddingVector:
        if text in self._example_to_intent:
            return self._for_intent(self._example_to_intent[text])

        lower = text.lower()
        if any(
            k in lower
            for k in ("you just", "you created", "you added", "you did", "earlier", "previous")
        ) and any(
            k in lower
            for k in ("below", "beside", "above", "underneath", "next to", "right", "left")
        ):
            v = self._for_intent(PromptIntent.INTERACTION_REFERENCE, 0.74)
            v[self._axes[PromptIntent.SPATIAL_RELATIONAL]] = 0.71
            return v

        if any(
            k in lower
            for k in (
                "you just",
                "you created",
                "you added",
                "undo",
                "redo",
                "previous",
                "earlier",
                "last change",
                "last thing",
                "from earlier",
                "go back",
                "what you did",
                "what you added",
                "what you created",
                "what you just",
                "the one you",
                "the thing you",
            )
        ):
            return self._for_intent(PromptIntent.INTERACTION_REFERENCE)

        if any(
            k in lower
            for k in (
                "below",
                "above",
                "beside",
                "underneath",
                "nearby",
                "around",
                "next to",
                "to the right",
                "to the left",
                "on the right",
                "on the left",
                "closer",
                "farther",
                "between",
                "surrounding",
                "near this",
            )
        ):
            return self._for_intent(PromptIntent.SPATIAL_RELATIONAL)

        # Ordinary content prompts: weak / equal-ish signal — spatial slightly lower.
        return self._for_intent(PromptIntent.INTERACTION_REFERENCE, 0.15)

    async def embed_text(self, text: str) -> EmbeddingVector:
        return self._classify_text(text)

    async def embed_texts(self, texts: list[str]) -> list[EmbeddingVector]:
        return [self._classify_text(t) for t in texts]

    async def embed_documents(self, texts: list[str]) -> list[EmbeddingVector]:
        self.document_calls += 1
        self.document_batch_sizes.append(len(texts))
        return [self._classify_text(t) for t in texts]

    async def embed_query(self, text: str) -> EmbeddingVector:
        self.query_calls += 1
        return self._classify_text(text)


@pytest.fixture(autouse=True)
def _reset_classifier() -> None:
    reset_prompt_intent_classifier()
    yield
    reset_prompt_intent_classifier()


def test_exactly_two_special_intents() -> None:
    assert len(PromptIntent) == 2
    assert len(INTENT_DEFINITIONS) == 2
    assert INTENT_EXEMPLAR_TOP_K == 3
    assert set(PromptIntent) == {
        PromptIntent.SPATIAL_RELATIONAL,
        PromptIntent.INTERACTION_REFERENCE,
    }
    assert "GENERAL" not in {m.name for m in PromptIntent}
    assert "general" not in {m.value for m in PromptIntent}
    for definition in INTENT_DEFINITIONS:
        assert len(definition.examples) >= 10
        blob = " ".join(definition.examples).lower()
        for banned in (
            "electricity",
            "gauss",
            "quantum",
            "note",
            "textbox",
            "canvas",
            "element",
            "equation",
        ):
            assert banned not in blob


def test_spatial_exemplars_avoid_history_language() -> None:
    spatial = " ".join(
        get_intent_definition(PromptIntent.SPATIAL_RELATIONAL).examples
    ).lower()
    for banned in ("just", "earlier", "previous", "last", "before"):
        assert banned not in spatial


def test_interaction_exemplars_avoid_spatial_language() -> None:
    interaction = " ".join(
        get_intent_definition(PromptIntent.INTERACTION_REFERENCE).examples
    ).lower()
    for banned in ("below", "above", "left", "right", "near", "beside"):
        assert banned not in interaction


@pytest.mark.asyncio
async def test_embeds_each_fragment_separately() -> None:
    fake = IntentAwareFakeEmbedding()
    clf = EmbeddingPromptIntentClassifier(fake)
    await clf.ensure_exemplars()
    expected = sum(len(d.examples) for d in INTENT_DEFINITIONS)
    assert fake.document_calls == 1
    assert fake.document_batch_sizes == [expected]


@pytest.mark.asyncio
async def test_classify_returns_two_scores_with_top_matches() -> None:
    fake = IntentAwareFakeEmbedding()
    clf = EmbeddingPromptIntentClassifier(fake)
    result = await clf.classify("What is around this?")

    assert len(result.scores) == 2
    assert result.exemplar_top_k == 3
    assert result.classified_intent is PromptIntent.SPATIAL_RELATIONAL
    assert result.score_margin == pytest.approx(result.top_score - result.second_score)
    winner = result.scores[0]
    assert len(winner.top_matches) == 3
    mean_top = sum(m.similarity for m in winner.top_matches) / 3
    assert winner.similarity == pytest.approx(mean_top)


@pytest.mark.asyncio
async def test_exemplar_cache_reused_then_rebuilt() -> None:
    fake = IntentAwareFakeEmbedding()
    clf = EmbeddingPromptIntentClassifier(fake)
    await clf.ensure_exemplars()
    await clf.ensure_exemplars()
    assert fake.document_calls == 1
    clf.invalidate_cache()
    await clf.ensure_exemplars()
    assert fake.document_calls == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("prompt", "expected"),
    [
        ("Put the material underneath the other one.", PromptIntent.SPATIAL_RELATIONAL),
        ("Can you move this to the right?", PromptIntent.SPATIAL_RELATIONAL),
        ("What is around this?", PromptIntent.SPATIAL_RELATIONAL),
        ("Place it beside that.", PromptIntent.SPATIAL_RELATIONAL),
        (
            "Move the biology content below the chemistry content.",
            PromptIntent.SPATIAL_RELATIONAL,
        ),
        ("Change the one you just made.", PromptIntent.INTERACTION_REFERENCE),
        ("Undo what you did.", PromptIntent.INTERACTION_REFERENCE),
        ("Can you remove what you added earlier?", PromptIntent.INTERACTION_REFERENCE),
        ("Go back to the previous version.", PromptIntent.INTERACTION_REFERENCE),
    ],
)
async def test_special_prompts_prefer_expected_intent(
    prompt: str, expected: PromptIntent
) -> None:
    clf = EmbeddingPromptIntentClassifier(IntentAwareFakeEmbedding())
    result = await clf.classify(prompt)
    assert result.classified_intent is expected
    assert len(result.scores) == 2
    winner_examples = set(get_intent_definition(expected).examples)
    for match in result.scores[0].top_matches:
        assert match.text in winner_examples


@pytest.mark.asyncio
async def test_mixed_signal_returns_one_of_the_two_special_intents() -> None:
    clf = EmbeddingPromptIntentClassifier(IntentAwareFakeEmbedding())
    result = await clf.classify("Move the one you just created below that.")
    assert result.classified_intent in {
        PromptIntent.INTERACTION_REFERENCE,
        PromptIntent.SPATIAL_RELATIONAL,
    }
    assert len(result.scores) == 2


@pytest.mark.asyncio
async def test_classify_from_embedding_does_not_reembed_query() -> None:
    fake = IntentAwareFakeEmbedding()
    clf = EmbeddingPromptIntentClassifier(fake)
    query_vec = await fake.embed_query("Undo what you did.")
    before = fake.query_calls
    result = await clf.classify_from_embedding("Undo what you did.", query_vec)
    assert fake.query_calls == before
    assert result.classified_intent is PromptIntent.INTERACTION_REFERENCE
