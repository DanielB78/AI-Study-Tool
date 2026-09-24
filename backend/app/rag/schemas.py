from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class TextElementIndexRequest(BaseModel):
    board_id: str = Field(..., min_length=1, max_length=128)
    element_id: str = Field(..., min_length=1, max_length=128)
    element_type: Literal["text"] = "text"
    text: str
    x: float
    y: float
    width: float = Field(..., gt=0)
    height: float = Field(..., gt=0)
    element_revision: str | None = None
    metadata: dict[str, Any] | None = None

    @field_validator("board_id", "element_id")
    @classmethod
    def strip_ids(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("must not be empty")
        return cleaned

    @field_validator("width", "height", "x", "y")
    @classmethod
    def finite_number(cls, value: float) -> float:
        if value != value:  # NaN
            raise ValueError("must be a finite number")
        return value


class GeometryUpdateRequest(BaseModel):
    x: float
    y: float
    width: float = Field(..., gt=0)
    height: float = Field(..., gt=0)

    @field_validator("width", "height", "x", "y")
    @classmethod
    def finite_number(cls, value: float) -> float:
        if value != value:
            raise ValueError("must be a finite number")
        return value


class IndexElementResponse(BaseModel):
    element_id: str
    chunk_count: int
    content_changed: bool
    embeddings_updated: bool = False


class GeometryUpdateResponse(BaseModel):
    element_id: str
    updated: int


class DeleteElementResponse(BaseModel):
    element_id: str
    deleted: int


class BoardReindexRequest(BaseModel):
    elements: list[TextElementIndexRequest] = Field(default_factory=list)


class BoardReindexResponse(BaseModel):
    board_id: str
    element_count: int
    chunk_count: int
    embeddings_written: int = 0


class RebuildEmbeddingsResponse(BaseModel):
    board_id: str
    chunk_count: int
    embeddings_written: int
    embedding_model: str


class RagChunkView(BaseModel):
    id: str
    element_id: str
    element_type: str
    chunk_index: int
    text: str
    start_char: int
    end_char: int
    x: float
    y: float
    width: float
    height: float
    content_hash: str
    has_embedding: bool = False
    embedding_model: str | None = None


class RetrieveRequest(BaseModel):
    board_id: str = Field(..., min_length=1, max_length=128)
    prompt: str
    top_k: int | None = Field(default=None, ge=1, le=500)
    # Explicit optional threshold — do NOT invent a default like 0.7.
    min_similarity: float | None = Field(default=None, ge=-1.0, le=1.0)

    @field_validator("board_id")
    @classmethod
    def strip_board(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("must not be empty")
        return cleaned


class MatchedChunkResponse(BaseModel):
    chunk_id: str
    chunk_index: int
    text: str
    similarity: float


class RetrievedElementResponse(BaseModel):
    element_id: str
    element_type: str
    score: float
    matched_chunks: list[MatchedChunkResponse]
    geometry: dict[str, float]


class RetrieveResponse(BaseModel):
    board_id: str
    query_chunks: int
    query_chunk_texts: list[str]
    embedding_model: str
    embedding_provider: str
    similarity_metric: str
    top_k: int
    min_similarity: float | None
    candidates: list[RetrievedElementResponse]
