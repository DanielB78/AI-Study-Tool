"""Centralized, easy-to-edit semantic prototypes for prompt intents.

Tune these natural-language descriptions during development; changing the
text invalidates the in-memory prototype embedding cache automatically.

GENERAL does NOT encode element / topic / board-wide scope — only that the
prompt lacks a special spatial or interaction-history signal.
"""

from __future__ import annotations

from dataclasses import dataclass

from .types import PromptIntent


@dataclass(frozen=True, slots=True)
class PromptIntentDefinition:
    intent: PromptIntent
    description: str


# Exactly three intents — edit descriptions here only.
INTENT_DEFINITIONS: tuple[PromptIntentDefinition, ...] = (
    PromptIntentDefinition(
        intent=PromptIntent.GENERAL,
        description=(
            "A normal request about the content or elements on the current canvas "
            "— such as editing, inspecting, summarising, checking, deleting, formatting, "
            "or explaining notes or equations — that does not primarily depend on "
            "spatial relationships or references to previous interactions."
        ),
    ),
    PromptIntentDefinition(
        intent=PromptIntent.SPATIAL_RELATIONAL,
        description=(
            "A request about canvas elements based on their physical position or "
            "relationship to other elements, such as nearby, around, above, below, "
            "beside, next to, left of, or right of something."
        ),
    ),
    PromptIntentDefinition(
        intent=PromptIntent.INTERACTION_REFERENCE,
        description=(
            "A request referring to something created, edited, moved, deleted, or "
            "discussed in a previous interaction, often using references such as "
            "it, that, the one you created, what you changed, what you just did, "
            "or something added earlier."
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
