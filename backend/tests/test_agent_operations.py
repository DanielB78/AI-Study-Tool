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
    assert "create_graph" in text
    assert "GRAPH EXPRESSIONS ARE NOT LATEX" in text


def test_valid_create_graph() -> None:
    payload = {
        "operations": [
            {
                "type": "create_graph",
                "expressions": [
                    {
                        "expression": "x**2",
                        "visible": True,
                        "domain_min": None,
                        "domain_max": None,
                    }
                ],
                "points": [],
                "viewport": {"x_min": -10, "x_max": 10, "y_min": -10, "y_max": 10},
                "settings": {
                    "title": None,
                    "x_axis_label": None,
                    "y_axis_label": None,
                    "show_grid": True,
                    "show_x_axis": True,
                    "show_y_axis": True,
                },
                "placement": {"mode": "viewport_default"},
            }
        ]
    }
    model = CanvasAgentResponse.model_validate(payload)
    assert model.operations[0].type == "create_graph"


def test_rejects_empty_create_graph() -> None:
    with pytest.raises(ValidationError):
        CanvasAgentResponse.model_validate(
            {
                "operations": [
                    {
                        "type": "create_graph",
                        "expressions": [],
                        "points": [],
                        "viewport": {
                            "x_min": -10,
                            "x_max": 10,
                            "y_min": -10,
                            "y_max": 10,
                        },
                        "settings": {},
                        "placement": {"mode": "viewport_default"},
                    }
                ]
            }
        )
