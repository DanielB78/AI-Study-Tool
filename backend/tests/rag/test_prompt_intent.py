"""Unit tests for EmbeddingPromptIntentClassifier (deterministic fakes — no LLM)."""

from __future__ import annotations

import pytest

from app.rag.embeddings.base import EmbeddingService, EmbeddingVector
from app.rag.intent.classifier import (
    EmbeddingPromptIntentClassifier,
    reset_prompt_intent_classifier,
)
from app.rag.intent.prototypes import INTENT_DEFINITIONS, get_intent_definition
from app.rag.intent.types import PromptIntent
from app.rag.similarity import cosine_similarity


DIM = 16


class IntentAwareFakeEmbedding(EmbeddingService):
    """Maps intent prototypes and keyword prompts to near-orthogonal basis vectors."""

    def __init__(self, dimension: int = DIM, model: str = "fake-intent-v1") -> None:
        self._dimension = dimension
        self._model = model
        self.document_calls = 0
        self.query_calls = 0
        # One axis per intent in the first 3 dims.
        self._axes = {
            PromptIntent.GENERAL: 0,
            PromptIntent.SPATIAL_RELATIONAL: 1,
            PromptIntent.INTERACTION_REFERENCE: 2,
        }
        self._desc_to_intent = {d.description: d.intent for d in INTENT_DEFINITIONS}

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

    def _classify_text(self, text: str, *, query: bool) -> EmbeddingVector:
        if text in self._desc_to_intent:
            return self._for_intent(self._desc_to_intent[text])
        lower = text.lower()
        # Ambiguous: interaction + spatial → either may win; prefer interaction slightly.
        if ("you just" in lower or "you created" in lower or "what you" in lower) and (
            "below" in lower or "beside" in lower or "next to" in lower
        ):
            v = self._for_intent(PromptIntent.INTERACTION_REFERENCE, 0.74)
            v[self._axes[PromptIntent.SPATIAL_RELATIONAL]] = 0.71
            v[self._axes[PromptIntent.GENERAL]] = 0.20
            return v
        if any(
            k in lower
            for k in (
                "you just",
                "you created",
                "you added",
                "undo what",
                "that note",
                "the one you",
                "what you changed",
                "what you just",
                "you did",
                "added earlier",
                "change that",
                "go back to the explanation",
            )
        ):
            return self._for_intent(PromptIntent.INTERACTION_REFERENCE)
        if any(
            k in lower
            for k in (
                "around",
                "next to",
                "underneath",
                "beside",
                "nearby",
                "above",
                "below",
                "left of",
                "right of",
            )
        ):
            return self._for_intent(PromptIntent.SPATIAL_RELATIONAL)
        # Everything else (element / topic / board-wide style) → GENERAL.
        return self._for_intent(PromptIntent.GENERAL)

    async def embed_text(self, text: str) -> EmbeddingVector:
        return self._classify_text(text, query=False)

    async def embed_texts(self, texts: list[str]) -> list[EmbeddingVector]:
        return [self._classify_text(t, query=False) for t in texts]

    async def embed_documents(self, texts: list[str]) -> list[EmbeddingVector]:
        self.document_calls += 1
        return [self._classify_text(t, query=False) for t in texts]

    async def embed_query(self, text: str) -> EmbeddingVector:
        self.query_calls += 1
        return self._classify_text(text, query=True)


@pytest.fixture(autouse=True)
def _reset_classifier() -> None:
    reset_prompt_intent_classifier()
    yield
    reset_prompt_intent_classifier()


def test_exactly_three_intents_and_prototypes() -> None:
    assert len(PromptIntent) == 3
    assert len(INTENT_DEFINITIONS) == 3
    assert {d.intent for d in INTENT_DEFINITIONS} == set(PromptIntent)
    assert set(PromptIntent) == {
        PromptIntent.GENERAL,
        PromptIntent.SPATIAL_RELATIONAL,
        PromptIntent.INTERACTION_REFERENCE,
    }
    for intent in PromptIntent:
        assert len(get_intent_definition(intent).description) > 40


@pytest.mark.asyncio
async def test_classify_returns_three_scores_sorted_winner_and_margin() -> None:
    fake = IntentAwareFakeEmbedding()
    clf = EmbeddingPromptIntentClassifier(fake)
    result = await clf.classify("Make the electric flux note shorter.")

    assert len(result.scores) == 3
    similarities = [s.similarity for s in result.scores]
    assert similarities == sorted(similarities, reverse=True)
    assert result.classified_intent is PromptIntent.GENERAL
    assert result.top_score == result.scores[0].similarity
    assert result.second_score == result.scores[1].similarity
    assert abs(result.score_margin - (result.top_score - result.second_score)) < 1e-9
    assert result.embedding_model == "fake-intent-v1"


@pytest.mark.asyncio
async def test_prototype_embeddings_cached_and_use_document_path() -> None:
    fake = IntentAwareFakeEmbedding()
    clf = EmbeddingPromptIntentClassifier(fake)
    await clf.classify("Delete the Gauss's law textbox.")
    await clf.classify("Check all my notes for errors.")
    assert fake.document_calls == 1  # three prototypes embedded once
    assert fake.query_calls == 2


@pytest.mark.asyncio
async def test_classify_from_embedding_does_not_reembed_query() -> None:
    fake = IntentAwareFakeEmbedding()
    clf = EmbeddingPromptIntentClassifier(fake)
    query_vec = await fake.embed_query("Check everything I've written about electricity.")
    calls_before = fake.query_calls
    result = await clf.classify_from_embedding(
        "Check everything I've written about electricity.",
        query_vec,
    )
    assert fake.query_calls == calls_before
    assert result.classified_intent is PromptIntent.GENERAL


@pytest.mark.asyncio
async def test_ensure_prototypes_reuses_then_rebuilds_after_invalidate() -> None:
    fake = IntentAwareFakeEmbedding()
    clf = EmbeddingPromptIntentClassifier(fake)
    await clf.ensure_prototypes()
    await clf.ensure_prototypes()
    assert fake.document_calls == 1
    assert len(await clf.ensure_prototypes()) == 3
    clf.invalidate_cache()
    await clf.ensure_prototypes()
    assert fake.document_calls == 2


def test_prototype_fingerprint_changes_when_text_changes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.rag.intent import prototypes as proto_mod

    before = proto_mod.prototype_content_fingerprint()
    original = proto_mod.INTENT_DEFINITIONS
    tweaked = (
        proto_mod.PromptIntentDefinition(
            intent=original[0].intent,
            description=original[0].description + " (tuned)",
        ),
        *original[1:],
    )
    monkeypatch.setattr(proto_mod, "INTENT_DEFINITIONS", tweaked)
    after = proto_mod.prototype_content_fingerprint()
    assert before != after


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("prompt", "expected"),
    [
        # Former element / topic / board-wide → GENERAL
        ("Make the electric flux note shorter.", PromptIntent.GENERAL),
        ("Delete the potential textbox.", PromptIntent.GENERAL),
        ("Make the electricity note blue.", PromptIntent.GENERAL),
        ("Explain the electric field equation.", PromptIntent.GENERAL),
        ("Check everything I've written about electricity.", PromptIntent.GENERAL),
        ("Check everything about electricity.", PromptIntent.GENERAL),
        ("Check all my notes for errors.", PromptIntent.GENERAL),
        ("Check all the notes on this canvas for mistakes.", PromptIntent.GENERAL),
        # Spatial
        ("What is written around the electricity note?", PromptIntent.SPATIAL_RELATIONAL),
        ("Summarise the notes next to Gauss's law.", PromptIntent.SPATIAL_RELATIONAL),
        ("Move this below the electric potential note.", PromptIntent.SPATIAL_RELATIONAL),
        (
            "Check everything underneath the quantum mechanics section.",
            PromptIntent.SPATIAL_RELATIONAL,
        ),
        ("Put this beside the electric flux note.", PromptIntent.SPATIAL_RELATIONAL),
        # Interaction
        ("Make the one you just created shorter.", PromptIntent.INTERACTION_REFERENCE),
        ("Delete what you just added.", PromptIntent.INTERACTION_REFERENCE),
        ("Change that note.", PromptIntent.INTERACTION_REFERENCE),
        ("Undo what you just did.", PromptIntent.INTERACTION_REFERENCE),
        (
            "Go back to the explanation you added earlier.",
            PromptIntent.INTERACTION_REFERENCE,
        ),
    ],
)
async def test_example_prompts_prefer_expected_intent(
    prompt: str, expected: PromptIntent
) -> None:
    clf = EmbeddingPromptIntentClassifier(IntentAwareFakeEmbedding())
    result = await clf.classify(prompt)
    assert result.classified_intent is expected
    assert len(result.scores) == 3


@pytest.mark.asyncio
async def test_mixed_signal_prefers_special_over_general() -> None:
    clf = EmbeddingPromptIntentClassifier(IntentAwareFakeEmbedding())
    result = await clf.classify(
        "Move the one you just created below Gauss's law."
    )
    assert result.classified_intent in {
        PromptIntent.INTERACTION_REFERENCE,
        PromptIntent.SPATIAL_RELATIONAL,
    }
    by_intent = {s.intent: s.similarity for s in result.scores}
    assert by_intent[PromptIntent.GENERAL] < by_intent[result.classified_intent]
    assert len(result.scores) == 3


@pytest.mark.asyncio
async def test_no_llm_only_embedding_similarity() -> None:
    fake = IntentAwareFakeEmbedding()
    clf = EmbeddingPromptIntentClassifier(fake)
    result = await clf.classify("Are there any incorrect equations anywhere in my notes?")
    proto = (await clf.ensure_prototypes())[PromptIntent.GENERAL]
    q = await fake.embed_query("Are there any incorrect equations anywhere in my notes?")
    assert result.classified_intent is PromptIntent.GENERAL
    assert result.scores[0].similarity == pytest.approx(cosine_similarity(q, proto))


def test_obsolete_five_way_intents_removed() -> None:
    names = {m.name for m in PromptIntent}
    assert "ELEMENT_SPECIFIC" not in names
    assert "TOPIC_SPECIFIC" not in names
    assert "BOARD_WIDE" not in names
    values = {m.value for m in PromptIntent}
    assert "element_specific" not in values
    assert "topic_specific" not in values
    assert "board_wide" not in values
