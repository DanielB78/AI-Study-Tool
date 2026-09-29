"""Centralized, easy-to-edit semantic prototypes for prompt intents.

Tune these natural-language descriptions during development; changing the
text invalidates the in-memory prototype embedding cache automatically.
"""

from __future__ import annotations

from dataclasses import dataclass

from .types import PromptIntent


@dataclass(frozen=True, slots=True)
class PromptIntentDefinition:
    intent: PromptIntent
    description: str


# Exact / near-exact prototypes from the product spec — edit here only.
INTENT_DEFINITIONS: tuple[PromptIntentDefinition, ...] = (
    PromptIntentDefinition(
        intent=PromptIntent.ELEMENT_SPECIFIC,
        description=(
            "A request about one specific note, textbox, equation, or canvas element, "
            "usually asking to edit, inspect, change, delete, format, or explain that "
            "particular element."
        ),
    ),
    PromptIntentDefinition(
        intent=PromptIntent.TOPIC_SPECIFIC,
        description=(
            "A request about notes or information related to a particular subject or "
            "topic on the canvas, asking to find, inspect, check, or summarise content "
            "related to that topic."
        ),
    ),
    PromptIntentDefinition(
        intent=PromptIntent.BOARD_WIDE,
        description=(
            "A broad request about the whole canvas or all notes, asking to inspect, "
            "summarise, check, organise, or reason about everything on the board."
        ),
    ),
    PromptIntentDefinition(
        intent=PromptIntent.SPATIAL_RELATIONAL,
        description=(
            "A request about canvas content based on physical position or spatial "
            "relationships, such as notes nearby, around, above, below, beside, or "
            "next to another element."
        ),
    ),
    PromptIntentDefinition(
        intent=PromptIntent.INTERACTION_REFERENCE,
        description=(
            "A request referring to something created, edited, moved, deleted, or "
            "discussed in a recent or previous interaction, often using words such as "
            "it, that, the one you created, or what you changed earlier."
        ),
    ),
)


def get_intent_definition(intent: PromptIntent) -> PromptIntentDefinition:
    for definition in INTENT_DEFINITIONS:
        if definition.intent is intent:
            return definition
    raise KeyError(f"No prototype definition for {intent!r}")


def prototype_content_fingerprint() -> str:
    """Stable content hash key for cache invalidation when prototypes change."""
    parts = [f"{d.intent.value}\0{d.description}" for d in INTENT_DEFINITIONS]
    return "\n".join(parts)
