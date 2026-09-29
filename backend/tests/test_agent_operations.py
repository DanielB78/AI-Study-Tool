"""Tests for canvas agent Pydantic operation schema."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.agent.operations import CanvasAgentResponse, canvas_agent_json_schema
from app.agent.prompts import load_canvas_editor_system_prompt


def test_valid_create_text() -> None:
    payload = {
        "operations": [
            {
                "type": "create_text",
                "text": "Electric flux measures field through a surface.",
                "placement": {"mode": "viewport_default"},
            }
        ]
    }
    model = CanvasAgentResponse.model_validate(payload)
    assert model.operations[0].type == "create_text"


def test_valid_update_text() -> None:
    payload = {
        "operations": [
            {
                "type": "update_text",
                "target_element_id": "textbox_18",
                "text": "Updated complete text.",
            }
        ]
    }
    model = CanvasAgentResponse.model_validate(payload)
    assert model.operations[0].type == "update_text"


def test_relative_placement() -> None:
    payload = {
        "operations": [
            {
                "type": "create_text",
                "text": "Near note",
                "placement": {
                    "mode": "relative_to_element",
                    "anchor_element_id": "textbox_1",
                    "relation": "near",
                },
            }
        ]
    }
    model = CanvasAgentResponse.model_validate(payload)
    assert model.operations[0].placement.mode == "relative_to_element"


def test_rejects_unknown_operation() -> None:
    with pytest.raises(ValidationError):
        CanvasAgentResponse.model_validate(
            {"operations": [{"type": "delete_element", "target_element_id": "x"}]}
        )


def test_rejects_empty_text() -> None:
    with pytest.raises(ValidationError):
        CanvasAgentResponse.model_validate(
            {
                "operations": [
                    {
                        "type": "update_text",
                        "target_element_id": "textbox_18",
                        "text": "",
                    }
                ]
            }
        )


def test_rejects_empty_operations() -> None:
    with pytest.raises(ValidationError):
        CanvasAgentResponse.model_validate({"operations": []})


def test_json_schema_has_discriminator_fields() -> None:
    schema = canvas_agent_json_schema()
    assert "properties" in schema or "$defs" in schema or "definitions" in schema


def test_system_prompt_loads() -> None:
    text = load_canvas_editor_system_prompt()
    assert "editing planner" in text.lower()
    assert "create_text" in text
    assert "update_text" in text
    assert "move_text" in text
    assert "resize_text" in text
    assert "delete_text" in text
    assert "update_text_style" in text
    assert "create_equation" in text
    assert "update_equation" in text
    assert "TEXT VS EQUATION" in text
    assert "anchor_operation_index" in text
    assert "TEXT STYLING" in text


def test_valid_create_equation() -> None:
    payload = {
        "operations": [
            {
                "type": "create_equation",
                "latex": r"E=mc^2",
                "placement": {"mode": "viewport_default"},
            }
        ]
    }
    model = CanvasAgentResponse.model_validate(payload)
    assert model.operations[0].type == "create_equation"


def test_relative_placement_with_operation_index() -> None:
    payload = {
        "operations": [
            {
                "type": "create_equation",
                "latex": r"F=ma",
                "placement": {
                    "mode": "relative_to_element",
                    "relation": "below",
                    "anchor_operation_index": 0,
                },
            }
        ]
    }
    model = CanvasAgentResponse.model_validate(payload)
    assert model.operations[0].placement.mode == "relative_to_element"


def test_valid_move_text() -> None:
    payload = {
        "operations": [
            {
                "type": "move_text",
                "target_element_id": "textbox_18",
                "placement": {
                    "mode": "relative_to_element",
                    "anchor_element_id": "textbox_42",
                    "relation": "below",
                },
            }
        ]
    }
    model = CanvasAgentResponse.model_validate(payload)
    assert model.operations[0].type == "move_text"


def test_valid_resize_text() -> None:
    payload = {
        "operations": [
            {
                "type": "resize_text",
                "target_element_id": "textbox_18",
                "width": 360,
            }
        ]
    }
    model = CanvasAgentResponse.model_validate(payload)
    assert model.operations[0].type == "resize_text"
    assert model.operations[0].width == 360


def test_valid_delete_text() -> None:
    payload = {
        "operations": [
            {
                "type": "delete_text",
                "target_element_id": "textbox_18",
            }
        ]
    }
    model = CanvasAgentResponse.model_validate(payload)
    assert model.operations[0].type == "delete_text"


def test_rejects_resize_without_dimensions() -> None:
    with pytest.raises(ValidationError):
        CanvasAgentResponse.model_validate(
            {
                "operations": [
                    {
                        "type": "resize_text",
                        "target_element_id": "textbox_18",
                    }
                ]
            }
        )


def test_valid_update_text_style() -> None:
    payload = {
        "operations": [
            {
                "type": "update_text_style",
                "target_element_id": "textbox_18",
                "style": {"text_color": "#0000FF", "bold": True},
            }
        ]
    }
    model = CanvasAgentResponse.model_validate(payload)
    assert model.operations[0].type == "update_text_style"
    assert model.operations[0].style.text_color == "#0000FF"
    assert model.operations[0].style.bold is True


def test_create_text_with_style() -> None:
    payload = {
        "operations": [
            {
                "type": "create_text",
                "text": "Styled",
                "placement": {"mode": "viewport_default"},
                "style": {"italic": True, "background_color": "#FFFF00"},
            }
        ]
    }
    model = CanvasAgentResponse.model_validate(payload)
    assert model.operations[0].type == "create_text"
    assert model.operations[0].style is not None
    assert model.operations[0].style.italic is True


def test_rejects_empty_style_on_update_text_style() -> None:
    with pytest.raises(ValidationError):
        CanvasAgentResponse.model_validate(
            {
                "operations": [
                    {
                        "type": "update_text_style",
                        "target_element_id": "textbox_18",
                        "style": {},
                    }
                ]
            }
        )


def test_rejects_unknown_style_property() -> None:
    with pytest.raises(ValidationError):
        CanvasAgentResponse.model_validate(
            {
                "operations": [
                    {
                        "type": "update_text_style",
                        "target_element_id": "textbox_18",
                        "style": {"font_size": 20},
                    }
                ]
            }
        )
