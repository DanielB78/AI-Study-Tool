"""Pydantic models for canvas agent operations (create_text / update_text).

Mirrors the frontend TypeScript schema in src/features/ai/agent/operations.ts
for future Structured Outputs / tool calling.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, TypeAdapter


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


CanvasOperation = Annotated[
    Union[CreateTextOperation, UpdateTextOperation],
    Field(discriminator="type"),
]


class CanvasAgentResponse(BaseModel):
    operations: list[CanvasOperation] = Field(..., min_length=1)


canvas_agent_response_adapter = TypeAdapter(CanvasAgentResponse)


def canvas_agent_json_schema() -> dict:
    """JSON Schema for Structured Outputs — keep aligned with frontend schema."""
    return canvas_agent_response_adapter.json_schema()
