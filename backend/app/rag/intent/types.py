"""Strongly typed prompt-intent models for retrieval classification."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class PromptIntent(str, Enum):
    """Retrieval-intent categories for a user prompt (single-label)."""

    ELEMENT_SPECIFIC = "element_specific"
    TOPIC_SPECIFIC = "topic_specific"
    BOARD_WIDE = "board_wide"
    SPATIAL_RELATIONAL = "spatial_relational"
    INTERACTION_REFERENCE = "interaction_reference"

    @property
    def display_name(self) -> str:
        return {
            PromptIntent.ELEMENT_SPECIFIC: "Element Specific",
            PromptIntent.TOPIC_SPECIFIC: "Topic Specific",
            PromptIntent.BOARD_WIDE: "Board Wide",
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
        description="All five intents ranked by similarity descending.",
    )
    top_score: float
    second_score: float
    score_margin: float = Field(
        ...,
        description="top_score - second_score (not a calibrated probability).",
    )
    embedding_model: str
    embedding_provider: str
