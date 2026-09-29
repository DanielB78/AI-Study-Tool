"""Prompt retrieval-intent classification (debug / observational only)."""

from .classifier import EmbeddingPromptIntentClassifier, get_prompt_intent_classifier
from .prototypes import INTENT_DEFINITIONS, INTENT_EXEMPLAR_TOP_K, get_intent_definition
from .types import (
    PromptIntent,
    PromptIntentClassification,
    PromptIntentExemplarMatch,
    PromptIntentScore,
)

__all__ = [
    "EmbeddingPromptIntentClassifier",
    "INTENT_DEFINITIONS",
    "INTENT_EXEMPLAR_TOP_K",
    "PromptIntent",
    "PromptIntentClassification",
    "PromptIntentExemplarMatch",
    "PromptIntentScore",
    "get_intent_definition",
    "get_prompt_intent_classifier",
]
