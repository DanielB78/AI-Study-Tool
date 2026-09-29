"""Pydantic models for canvas agent operations.

Mirrors src/features/ai/agent/operations.ts for Structured Outputs.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator


class ViewportDefaultPlacement(BaseModel):
    mode: Literal["viewport_default"] = "viewport_default"


class RelativePlacement(BaseModel):
    mode: Literal["relative_to_element"] = "relative_to_element"
    relation: Literal["left_of", "right_of", "above", "below", "near"]
    anchor_element_id: str | None = Field(default=None, min_length=1)
    anchor_operation_index: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def require_anchor(self) -> RelativePlacement:
        if not self.anchor_element_id and self.anchor_operation_index is None:
            raise ValueError(
                "relative_to_element requires anchor_element_id or anchor_operation_index"
            )
        return self


class AbsolutePlacement(BaseModel):
    mode: Literal["absolute"] = "absolute"
    x: float
    y: float


Placement = Annotated[
    Union[ViewportDefaultPlacement, RelativePlacement, AbsolutePlacement],
    Field(discriminator="mode"),
]


class TextStylePatch(BaseModel):
    """Optional PATCH fields for text colour / fill / weight / decoration."""

    model_config = ConfigDict(extra="forbid")

    text_color: str | None = None
    background_color: str | None = None
    bold: bool | None = None
    italic: bool | None = None
    underline: bool | None = None


class CreateTextOperation(BaseModel):
    type: Literal["create_text"] = "create_text"
    text: str = Field(..., min_length=1)
    placement: Placement
    style: TextStylePatch | None = None


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


class UpdateTextStyleOperation(BaseModel):
    type: Literal["update_text_style"] = "update_text_style"
    target_element_id: str = Field(..., min_length=1)
    style: TextStylePatch

    @model_validator(mode="after")
    def require_non_empty_style(self) -> UpdateTextStyleOperation:
        if not self.style.model_fields_set:
            raise ValueError("update_text_style.style must include at least one property")
        return self


class CreateEquationOperation(BaseModel):
    type: Literal["create_equation"] = "create_equation"
    latex: str = Field(..., min_length=1)
    placement: Placement


class UpdateEquationOperation(BaseModel):
    type: Literal["update_equation"] = "update_equation"
    target_element_id: str = Field(..., min_length=1)
    latex: str = Field(..., min_length=1)


class MoveEquationOperation(BaseModel):
    type: Literal["move_equation"] = "move_equation"
    target_element_id: str = Field(..., min_length=1)
    placement: Placement


class ResizeEquationOperation(BaseModel):
    type: Literal["resize_equation"] = "resize_equation"
    target_element_id: str = Field(..., min_length=1)
    width: float | None = None
    height: float | None = None

    @model_validator(mode="after")
    def require_dimension(self) -> ResizeEquationOperation:
        if self.width is None and self.height is None:
            raise ValueError("resize_equation requires width and/or height")
        return self


class DeleteEquationOperation(BaseModel):
    type: Literal["delete_equation"] = "delete_equation"
    target_element_id: str = Field(..., min_length=1)


CanvasOperation = Annotated[
    Union[
        CreateTextOperation,
        UpdateTextOperation,
        MoveTextOperation,
        ResizeTextOperation,
        DeleteTextOperation,
        UpdateTextStyleOperation,
        CreateEquationOperation,
        UpdateEquationOperation,
        MoveEquationOperation,
        ResizeEquationOperation,
        DeleteEquationOperation,
    ],
    Field(discriminator="type"),
]


class CanvasAgentResponse(BaseModel):
    operations: list[CanvasOperation] = Field(..., min_length=1)


canvas_agent_response_adapter = TypeAdapter(CanvasAgentResponse)


def canvas_agent_json_schema() -> dict:
    """JSON Schema for Structured Outputs — keep aligned with frontend schema."""
    return canvas_agent_response_adapter.json_schema()
