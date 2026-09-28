from __future__ import annotations

import pytest

from app.interactions.undo_intent import detect_undo_intent


@pytest.mark.parametrize(
    "prompt",
    [
        "undo what you just did",
        "Undo that!",
        "UNDO YOUR LAST CHANGE",
        "undo the last ai change.",
    ],
)
def test_detects_undo(prompt: str) -> None:
    assert detect_undo_intent(prompt) == "undo"


@pytest.mark.parametrize(
    "prompt",
    [
        "redo that",
        "Redo what you just undid",
        "redo your last change!",
    ],
)
def test_detects_redo(prompt: str) -> None:
    assert detect_undo_intent(prompt) == "redo"


@pytest.mark.parametrize(
    "prompt",
    [
        "explain what undo means",
        "write a note about undo",
        "please undo my homework mistakes in the essay",
        "can you redo the Faraday note with more detail",
        "undo",
        "redo",
        "",
        "  ",
    ],
)
def test_does_not_false_positive(prompt: str) -> None:
    assert detect_undo_intent(prompt) is None
