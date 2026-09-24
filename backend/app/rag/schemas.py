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
