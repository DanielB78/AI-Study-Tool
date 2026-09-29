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
        # One axis per intent in the first 5 dims.
        self._axes = {
            PromptIntent.ELEMENT_SPECIFIC: 0,
            PromptIntent.TOPIC_SPECIFIC: 1,
            PromptIntent.BOARD_WIDE: 2,
            PromptIntent.SPATIAL_RELATIONAL: 3,
            PromptIntent.INTERACTION_REFERENCE: 4,
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
        # Ambiguous: interaction + spatial → slightly prefer interaction.
        if ("you just" in lower or "you created" in lower or "what you" in lower) and (
            "below" in lower or "beside" in lower or "next to" in lower
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
                "undo what",
                "that note",
                "the one you",
                "what you changed",
                "you did",
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
            )
        ):
            return self._for_intent(PromptIntent.SPATIAL_RELATIONAL)
        if any(
            k in lower
            for k in (
                "entire canvas",
                "everything on this board",
                "all my notes",
                "anywhere in my notes",
                "this entire",
                "look through everything",
            )
        ):
            return self._for_intent(PromptIntent.BOARD_WIDE)
        if any(
            k in lower
            for k in (
                "about electricity",
                "quantum mechanics",
                "magnetic fields",
                "about gauss",
                "related to",
                "everything i've written about",
                "summarise my",
                "look through my notes about",
            )
        ):
            return self._for_intent(PromptIntent.TOPIC_SPECIFIC)
        if any(
            k in lower
            for k in (
                "make the",
                "delete the",
                "resize the",
                "fix the equation",
                "textbox blue",
                "shorter",
            )
        ):
            return self._for_intent(PromptIntent.ELEMENT_SPECIFIC)
        # Default weak board-wide
        return self._for_intent(PromptIntent.BOARD_WIDE, 0.2 if query else 0.2)

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


def test_all_five_intents_and_prototypes_exist() -> None:
    assert len(PromptIntent) == 5
    assert len(INTENT_DEFINITIONS) == 5
    intents = {d.intent for d in INTENT_DEFINITIONS}
    assert intents == set(PromptIntent)
    for intent in PromptIntent:
        definition = get_intent_definition(intent)
        assert len(definition.description) > 40


@pytest.mark.asyncio
async def test_classify_returns_all_scores_sorted_winner_and_margin() -> None:
    fake = IntentAwareFakeEmbedding()
    clf = EmbeddingPromptIntentClassifier(fake)
    result = await clf.classify("Make the electric flux note shorter.")

    assert len(result.scores) == 5
    similarities = [s.similarity for s in result.scores]
    assert similarities == sorted(similarities, reverse=True)
    assert result.classified_intent is PromptIntent.ELEMENT_SPECIFIC
    assert result.top_score == result.scores[0].similarity
    assert result.second_score == result.scores[1].similarity
    assert abs(result.score_margin - (result.top_score - result.second_score)) < 1e-9
    assert result.embedding_model == "fake-intent-v1"
    # No threshold — always a winner even if margins are tiny.
    assert result.classified_intent is result.scores[0].intent


@pytest.mark.asyncio
async def test_prototype_embeddings_cached_and_use_document_path() -> None:
    fake = IntentAwareFakeEmbedding()
    clf = EmbeddingPromptIntentClassifier(fake)
    await clf.classify("Delete the Gauss's law textbox.")
    await clf.classify("Resize the note about Coulomb's law.")
    assert fake.document_calls == 1  # prototypes embedded once
    assert fake.query_calls == 2


@pytest.mark.asyncio
async def test_classify_from_embedding_does_not_reembed_query() -> None:
    fake = IntentAwareFakeEmbedding()
    clf = EmbeddingPromptIntentClassifier(fake)
    query_vec = await fake.embed_query("Summarise my quantum mechanics notes.")
    calls_before = fake.query_calls
    result = await clf.classify_from_embedding(
        "Summarise my quantum mechanics notes.",
        query_vec,
    )
    assert fake.query_calls == calls_before
    assert result.classified_intent is PromptIntent.TOPIC_SPECIFIC


@pytest.mark.asyncio
async def test_model_change_rebuilds_prototypes() -> None:
    fake_a = IntentAwareFakeEmbedding(model="model-a")
    clf = EmbeddingPromptIntentClassifier(fake_a)
    await clf.classify("Check all my notes for mistakes.")
    assert fake_a.document_calls == 1

    fake_b = IntentAwareFakeEmbedding(model="model-b")
    clf_b = EmbeddingPromptIntentClassifier(fake_b)
    # Swap underlying service identity via new classifier
    await clf_b.classify("Look through everything on this board.")
    assert fake_b.document_calls == 1


@pytest.mark.asyncio
async def test_ensure_prototypes_reuses_then_rebuilds_after_invalidate() -> None:
    fake = IntentAwareFakeEmbedding()
    clf = EmbeddingPromptIntentClassifier(fake)
    await clf.ensure_prototypes()
    await clf.ensure_prototypes()
    assert fake.document_calls == 1
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
        ("Make the electric flux note shorter.", PromptIntent.ELEMENT_SPECIFIC),
        ("Delete the Gauss's law textbox.", PromptIntent.ELEMENT_SPECIFIC),
        ("Make the electricity textbox blue.", PromptIntent.ELEMENT_SPECIFIC),
        ("Check everything I've written about electricity.", PromptIntent.TOPIC_SPECIFIC),
        ("Summarise my quantum mechanics notes.", PromptIntent.TOPIC_SPECIFIC),
        ("Find anything related to magnetic fields.", PromptIntent.TOPIC_SPECIFIC),
        ("Check all my notes for mistakes.", PromptIntent.BOARD_WIDE),
        ("Summarise this entire canvas.", PromptIntent.BOARD_WIDE),
        ("Look through everything on this board.", PromptIntent.BOARD_WIDE),
        (
            "Summarise the notes around the Gauss's law textbox.",
            PromptIntent.SPATIAL_RELATIONAL,
        ),
        ("What is written next to the electricity note?", PromptIntent.SPATIAL_RELATIONAL),
        ("Make the one you just created shorter.", PromptIntent.INTERACTION_REFERENCE),
        ("Undo what you just did.", PromptIntent.INTERACTION_REFERENCE),
        ("Change what you added earlier.", PromptIntent.INTERACTION_REFERENCE),
    ],
)
async def test_example_prompts_prefer_expected_intent(
    prompt: str, expected: PromptIntent
) -> None:
    clf = EmbeddingPromptIntentClassifier(IntentAwareFakeEmbedding())
    result = await clf.classify(prompt)
    assert result.classified_intent is expected
    assert len(result.scores) == 5


@pytest.mark.asyncio
async def test_ambiguous_prompt_still_single_label_with_close_runners() -> None:
    clf = EmbeddingPromptIntentClassifier(IntentAwareFakeEmbedding())
    result = await clf.classify(
        "Move the note you just created below Gauss's law."
    )
    assert result.classified_intent is PromptIntent.INTERACTION_REFERENCE
    by_intent = {s.intent: s.similarity for s in result.scores}
    assert by_intent[PromptIntent.INTERACTION_REFERENCE] > by_intent[
        PromptIntent.SPATIAL_RELATIONAL
    ]
    assert by_intent[PromptIntent.SPATIAL_RELATIONAL] > 0.5
    assert result.score_margin == pytest.approx(
        by_intent[PromptIntent.INTERACTION_REFERENCE]
        - by_intent[PromptIntent.SPATIAL_RELATIONAL]
    )


@pytest.mark.asyncio
async def test_no_llm_only_embedding_similarity() -> None:
    fake = IntentAwareFakeEmbedding()
    clf = EmbeddingPromptIntentClassifier(fake)
    result = await clf.classify("Are there any incorrect equations anywhere in my notes?")
    # Sanity: scores are real cosine values from our vectors
    proto = (await clf.ensure_prototypes())[PromptIntent.BOARD_WIDE]
    q = await fake.embed_query("Are there any incorrect equations anywhere in my notes?")
    assert result.scores[0].similarity == pytest.approx(cosine_similarity(q, proto))
