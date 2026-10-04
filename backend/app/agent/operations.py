"""Pydantic models for canvas agent operations.

Mirrors the frontend TypeScript schema in src/features/ai/agent/operations.ts
for future Structured Outputs / tool calling.

Note: frontend also supports create_structured_note; this module tracks
create_text / update_text / create_graph for structured-output experiments.
"""

from __future__ import annotations

from typing import Annotated, Literal, Optional, Union

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


class CreateGraphExpressionSpec(BaseModel):
    expression: str = Field(..., min_length=1)
    visible: bool = True
    domain_min: Optional[float] = None
    domain_max: Optional[float] = None


class CreateGraphPointSpec(BaseModel):
    x: float
    y: float
    label: str = ""
    visible: bool = True


class CreateGraphViewportSpec(BaseModel):
    x_min: float = -10
    x_max: float = 10
    y_min: float = -10
    y_max: float = 10

    @model_validator(mode="after")
    def validate_ranges(self) -> "CreateGraphViewportSpec":
        if not (self.x_min < self.x_max and self.y_min < self.y_max):
            raise ValueError("viewport requires x_min < x_max and y_min < y_max")
        return self


class CreateGraphSettingsSpec(BaseModel):
    title: Optional[str] = None
    x_axis_label: Optional[str] = None
    y_axis_label: Optional[str] = None
    show_grid: bool = True
    show_x_axis: bool = True
    show_y_axis: bool = True


class CreateGraphOperation(BaseModel):
    type: Literal["create_graph"] = "create_graph"
    expressions: list[CreateGraphExpressionSpec] = Field(default_factory=list)
    points: list[CreateGraphPointSpec] = Field(default_factory=list)
    viewport: CreateGraphViewportSpec = Field(default_factory=CreateGraphViewportSpec)
    settings: CreateGraphSettingsSpec = Field(default_factory=CreateGraphSettingsSpec)
    placement: Placement

    @model_validator(mode="after")
    def require_content(self) -> "CreateGraphOperation":
        if not self.expressions and not self.points:
            raise ValueError("create_graph requires at least one expression or point")
        return self


CanvasOperation = Annotated[
    Union[CreateTextOperation, UpdateTextOperation, CreateGraphOperation],
    Field(discriminator="type"),
]


class CanvasAgentResponse(BaseModel):
    operations: list[CanvasOperation] = Field(..., min_length=1)


canvas_agent_response_adapter = TypeAdapter(CanvasAgentResponse)


def canvas_agent_json_schema() -> dict:
    """JSON Schema for Structured Outputs — keep aligned with frontend schema."""
    return canvas_agent_response_adapter.json_schema()
