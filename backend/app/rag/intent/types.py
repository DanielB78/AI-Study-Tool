"""Strongly typed prompt-intent models for retrieval classification."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class PromptIntent(str, Enum):
    """Special-context signals for a user prompt (single-label, debug-only).

    Only intents that indicate a special retrieval mechanism:
    - SPATIAL_RELATIONAL — physical position / relative placement language
    - INTERACTION_REFERENCE — dependence on previous AI/user actions

    Ordinary content/edit prompts are not given a separate GENERAL label;
    they simply score lower on both special intents. Canvas context scope
    for ordinary prompts is decided later by semantic-distribution analysis.
    """

    SPATIAL_RELATIONAL = "spatial_relational"
    INTERACTION_REFERENCE = "interaction_reference"

    @property
    def display_name(self) -> str:
        return {
            PromptIntent.SPATIAL_RELATIONAL: "Spatial / Relational",
            PromptIntent.INTERACTION_REFERENCE: "Interaction Reference",
        }[self]


class PromptIntentExemplarMatch(BaseModel):
    """One exemplar fragment and its cosine similarity to the prompt."""

    text: str
    similarity: float


class PromptIntentScore(BaseModel):
    intent: PromptIntent
    similarity: float = Field(
        ...,
        description="Mean of top-K exemplar similarities for this intent.",
    )
    display_name: str
    top_matches: list[PromptIntentExemplarMatch] = Field(
        default_factory=list,
        description="Top matching exemplar fragments (highest similarity first).",
    )


class PromptIntentClassification(BaseModel):
    """Full classification result — all scores, winner, margin. Debug-only."""

    classified_intent: PromptIntent
    scores: list[PromptIntentScore] = Field(
        ...,
        description="Both special intents ranked by intent score descending.",
    )
    top_score: float
    second_score: float
    score_margin: float = Field(
        ...,
        description="top_score - second_score (not a calibrated probability).",
    )
    embedding_model: str
    embedding_provider: str
    exemplar_top_k: int = Field(
        ...,
        description="K used when averaging top exemplar similarities per intent.",
    )
