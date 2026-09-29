"""Pydantic models for canvas agent operations.

Mirrors src/features/ai/agent/operations.ts for Structured Outputs.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, TypeAdapter, model_validator


class ViewportDefaultPlacement(BaseModel):
    mode: Literal["viewport_default"] = "viewport_default"


class RelativePlacement(BaseModel):
    mode: Literal["relative_to_element"] = "relative_to_element"
    anchor_element_id: str = Field(..., min_length=1)
    relation: Literal["left_of", "right_of", "above", "below", "near"]


class AbsolutePlacement(BaseModel):
    mode: Literal["absolute"] = "absolute"
    x: float
    y: float


Placement = Annotated[
    Union[ViewportDefaultPlacement, RelativePlacement, AbsolutePlacement],
    Field(discriminator="mode"),
]


class CreateTextOperation(BaseModel):
    type: Literal["create_text"] = "create_text"
    text: str = Field(..., min_length=1)
    placement: Placement


class UpdateTextOperation(BaseModel):
    type: Literal["update_text"] = "update_text"
    target_element_id: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1)


class MoveTextOperation(BaseModel):
    type: Literal["move_text"] = "move_text"
    target_element_id: str = Field(..., min_length=1)
    placement: Placement


class ResizeTextOperation(BaseModel):
    type: Literal["resize_text"] = "resize_text"
    target_element_id: str = Field(..., min_length=1)
    width: float | None = None
    height: float | None = None

    @model_validator(mode="after")
    def require_dimension(self) -> ResizeTextOperation:
        if self.width is None and self.height is None:
            raise ValueError("resize_text requires width and/or height")
        return self


class DeleteTextOperation(BaseModel):
    type: Literal["delete_text"] = "delete_text"
    target_element_id: str = Field(..., min_length=1)


CanvasOperation = Annotated[
    Union[
        CreateTextOperation,
        UpdateTextOperation,
        MoveTextOperation,
        ResizeTextOperation,
        DeleteTextOperation,
    ],
    Field(discriminator="type"),
]


class CanvasAgentResponse(BaseModel):
    operations: list[CanvasOperation] = Field(..., min_length=1)


canvas_agent_response_adapter = TypeAdapter(CanvasAgentResponse)


def canvas_agent_json_schema() -> dict:
    """JSON Schema for Structured Outputs — keep aligned with frontend schema."""
    return canvas_agent_response_adapter.json_schema()
