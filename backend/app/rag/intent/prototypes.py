"""Centralized abstract exemplar fragments for prompt-intent classification.

Each fragment is embedded separately. Intent score = mean of top-K exemplar
similarities. Tune these lists during development — changing text invalidates
the in-memory exemplar embedding cache.

Only special-context intents are classified (spatial / interaction). Ordinary
content prompts are not given a GENERAL label.
"""

from __future__ import annotations

from dataclasses import dataclass

from .types import PromptIntent

# Mean of the top-K exemplar similarities per intent.
INTENT_EXEMPLAR_TOP_K = 3


@dataclass(frozen=True, slots=True)
class PromptIntentDefinition:
    intent: PromptIntent
    examples: tuple[str, ...]


# Exactly two special-context intents — short, subject-free fragments.
INTENT_DEFINITIONS: tuple[PromptIntentDefinition, ...] = (
    PromptIntentDefinition(
        intent=PromptIntent.SPATIAL_RELATIONAL,
        examples=(
            "move below",
            "place above",
            "put beside",
            "move to the right",
            "move to the left",
            "put underneath",
            "place nearby",
            "move closer",
            "move farther away",
            "what is around this",
            "what is beside this",
            "what is above this",
            "what is below this",
            "what is next to this",
            "place between",
            "move underneath this",
            "put on the right",
            "put on the left",
            "surrounding this",
            "near this",
        ),
    ),
    PromptIntentDefinition(
        intent=PromptIntent.INTERACTION_REFERENCE,
        examples=(
            "the one you just made",
            "what you just changed",
            "undo that",
            "redo that",
            "change what you added",
            "remove what you created",
            "the previous one",
            "what you did earlier",
            "go back to before",
            "change that again",
            "the last thing you changed",
            "what you created earlier",
            "what you added before",
            "the thing you just made",
            "restore the previous version",
            "undo the last change",
            "redo the last change",
            "the one from earlier",
            "change what you did",
            "remove what you just added",
        ),
    ),
)


def get_intent_definition(intent: PromptIntent) -> PromptIntentDefinition:
    for definition in INTENT_DEFINITIONS:
        if definition.intent is intent:
            return definition
    raise KeyError(f"No prototype definition for {intent!r}")


def exemplar_content_fingerprint() -> str:
    """Stable content hash key for cache invalidation when exemplars change."""
    parts: list[str] = [f"top_k={INTENT_EXEMPLAR_TOP_K}"]
    for definition in INTENT_DEFINITIONS:
        parts.append(definition.intent.value)
        parts.extend(definition.examples)
    return "\n".join(parts)


# Back-compat alias
prototype_content_fingerprint = exemplar_content_fingerprint
