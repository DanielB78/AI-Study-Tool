from __future__ import annotations

from app.interactions.summary import summarize_operations


def test_create_text_viewport() -> None:
    summary = summarize_operations(
        "Add a note about Gauss's law",
        [
            {
                "type": "create_text",
                "text": "Gauss's law relates flux to charge.",
                "placement": {"mode": "viewport_default"},
            }
        ],
        created_ids=["el-1"],
    )
    assert summary == "Created textbox el-1 about Gauss's law."


def test_create_text_relative() -> None:
    summary = summarize_operations(
        "Put a note about Faraday below the other one",
        [
            {
                "type": "create_text",
                "text": "Faraday's law describes induction.",
                "placement": {
                    "mode": "relative_to_element",
                    "anchor_element_id": "anchor-1",
                    "relation": "below",
                },
            }
        ],
        created_ids=["el-2"],
    )
    assert "below textbox anchor-1" in summary
    assert "el-2" in summary
    assert "Faraday" in summary


def test_update_text_uses_preview() -> None:
    summary = summarize_operations(
        "Rewrite this note",
        [
            {
                "type": "update_text",
                "target_element_id": "t1",
                "text": "Updated body about Schrödinger equation.",
            }
        ],
        element_previews={"t1": "Old Schrödinger notes"},
    )
    assert summary.startswith("Updated textbox t1")
    assert "Schrödinger" in summary or "Schrodinger" in summary or "Old" in summary


def test_multiple_operations() -> None:
    summary = summarize_operations(
        "Do both",
        [
            {
                "type": "create_text",
                "text": "A",
                "placement": {"mode": "viewport_default"},
            },
            {
                "type": "update_text",
                "target_element_id": "t9",
                "text": "B",
            },
            {
                "type": "create_text",
                "text": "C",
                "placement": {"mode": "viewport_default"},
            },
        ],
        created_ids=["c1", "c2"],
    )
    assert summary == "Created c1, updated t9 and created c2."


def test_empty_operations() -> None:
    assert summarize_operations("hi", []) == "No canvas changes were applied."


def test_move_text() -> None:
    summary = summarize_operations(
        "Move the Gauss note below the other one",
        [
            {
                "type": "move_text",
                "target_element_id": "textbox_18",
                "placement": {
                    "mode": "relative_to_element",
                    "anchor_element_id": "textbox_42",
                    "relation": "below",
                },
            }
        ],
    )
    assert summary == "Moved textbox textbox_18 below textbox textbox_42."


def test_resize_text() -> None:
    summary = summarize_operations(
        "Make it bigger",
        [
            {
                "type": "resize_text",
                "target_element_id": "textbox_18",
                "width": 360,
                "height": 120,
            }
        ],
    )
    assert summary == "Resized textbox textbox_18 to 360 × 120."


def test_delete_text() -> None:
    summary = summarize_operations(
        "Delete the Gauss note",
        [{"type": "delete_text", "target_element_id": "textbox_18"}],
        element_previews={"textbox_18": "Old Gauss law notes"},
    )
    assert summary.startswith("Deleted textbox textbox_18")
    assert "Old Gauss law notes" in summary


def test_multiple_move_resize_delete() -> None:
    summary = summarize_operations(
        "rearrange",
        [
            {
                "type": "move_text",
                "target_element_id": "textbox_1",
                "placement": {"mode": "absolute", "x": 10, "y": 20},
            },
            {"type": "resize_text", "target_element_id": "textbox_2", "width": 300},
            {"type": "delete_text", "target_element_id": "textbox_3"},
        ],
    )
    assert summary == "Moved textbox_1, resized textbox_2 and deleted textbox_3."


def test_update_text_style_bold_underline() -> None:
    summary = summarize_operations(
        "Make it bold and underlined",
        [
            {
                "type": "update_text_style",
                "target_element_id": "textbox_18",
                "style": {"bold": True, "underline": True},
            }
        ],
    )
    assert summary == "Made textbox textbox_18 bold and underlined."


def test_update_text_style_text_color() -> None:
    summary = summarize_operations(
        "Make text blue",
        [
            {
                "type": "update_text_style",
                "target_element_id": "textbox_18",
                "style": {"text_color": "#0000FF"},
            }
        ],
    )
    assert summary == "Changed textbox textbox_18 to #0000FF text."


def test_update_text_style_fill() -> None:
    summary = summarize_operations(
        "Highlight yellow",
        [
            {
                "type": "update_text_style",
                "target_element_id": "textbox_18",
                "style": {"background_color": "#FFFF00"},
            }
        ],
    )
    assert summary == "Filled textbox textbox_18 #FFFF00."


def test_multiple_includes_styled() -> None:
    summary = summarize_operations(
        "edit and style",
        [
            {"type": "update_text", "target_element_id": "textbox_1", "text": "New"},
            {
                "type": "update_text_style",
                "target_element_id": "textbox_2",
                "style": {"bold": True},
            },
        ],
    )
    assert summary == "Updated textbox_1 and styled textbox_2."
