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
