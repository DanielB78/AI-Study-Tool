"""Strongly typed prompt-intent models for retrieval classification."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class PromptIntent(str, Enum):
    """Special-context signals for a user prompt (single-label, debug-only).

    GENERAL does NOT mean element-specific, topic-specific, or board-wide.
    It means: no special spatial or interaction-reference retrieval signal
    was detected. Canvas context scope for GENERAL prompts will be decided
    later by a separate semantic-distribution analysis system — not by this
    classifier.
    """

    GENERAL = "general"
    SPATIAL_RELATIONAL = "spatial_relational"
    INTERACTION_REFERENCE = "interaction_reference"

    @property
    def display_name(self) -> str:
        return {
            PromptIntent.GENERAL: "General",
            PromptIntent.SPATIAL_RELATIONAL: "Spatial / Relational",
            PromptIntent.INTERACTION_REFERENCE: "Interaction Reference",
        }[self]


class PromptIntentScore(BaseModel):
    intent: PromptIntent
    similarity: float
    description: str
    display_name: str


class PromptIntentClassification(BaseModel):
    """Full classification result — all scores, winner, margin. Debug-only."""

    classified_intent: PromptIntent
    scores: list[PromptIntentScore] = Field(
        ...,
        description="All three intents ranked by similarity descending.",
    )
    top_score: float
    second_score: float
    score_margin: float = Field(
        ...,
        description="top_score - second_score (not a calibrated probability).",
    )
    embedding_model: str
    embedding_provider: str
