from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

InteractionStatus = Literal["applied", "undone", "redone"]
Provenance = Literal["recent", "historical", "selected"]


class InteractionCreateRequest(BaseModel):
    board_id: str = Field(..., min_length=1, max_length=128)
    user_prompt: str
    transaction_id: str = Field(..., min_length=1, max_length=128)
    operations: list[dict[str, Any]] = Field(default_factory=list)
    affected_element_ids: list[str] = Field(default_factory=list)
    created_element_ids: list[str] = Field(default_factory=list)
    updated_element_ids: list[str] = Field(default_factory=list)
    # Optional text previews keyed by element id (for summary generation).
    element_previews: dict[str, str] | None = None
    # Optional precomputed summary — if omitted, backend summarizes operations.
    action_summary: str | None = None

    @field_validator("board_id", "transaction_id")
    @classmethod
    def strip_ids(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("must not be empty")
        return cleaned


class InteractionStatusUpdate(BaseModel):
    status: InteractionStatus


class InteractionView(BaseModel):
    id: str
    board_id: str
    user_prompt: str
    action_summary: str
    transaction_id: str
    affected_element_ids: list[str]
    created_element_ids: list[str]
    updated_element_ids: list[str]
    status: InteractionStatus
    has_embedding: bool = False
    embedding_model: str | None = None
    content_hash: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    # Present on retrieve responses.
    similarity: float | None = None
    provenance: Provenance | None = None


class InteractionRecordResponse(BaseModel):
    id: str
    board_id: str
    transaction_id: str
    action_summary: str
    status: InteractionStatus
    embeddings_written: bool = False
    embedding_model: str | None = None


class InteractionRetrieveRequest(BaseModel):
    prompt: str
    recent_count: int | None = Field(default=None, ge=0, le=50)
    top_k: int | None = Field(default=None, ge=1, le=100)
    min_similarity: float | None = Field(default=None, ge=-1.0, le=1.0)
    selected_historical_ids: list[str] | None = None

    @field_validator("prompt")
    @classmethod
    def strip_prompt(cls, value: str) -> str:
        return value.strip()


class InteractionRetrieveResponse(BaseModel):
    board_id: str
    recent: list[InteractionView]
    historical: list[InteractionView]
    embedding_model: str | None = None
    embedding_provider: str | None = None
    recent_count: int
    top_k: int
    min_similarity: float | None


class RebuildInteractionEmbeddingsResponse(BaseModel):
    board_id: str
    interaction_count: int
    embeddings_written: int
    embedding_model: str


class UndoIntentRequest(BaseModel):
    prompt: str


class UndoIntentResponse(BaseModel):
    intent: Literal["undo", "redo"] | None
