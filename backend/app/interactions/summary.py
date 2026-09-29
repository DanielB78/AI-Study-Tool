"""Deterministic AI action summaries — no LLM calls.

Mirrors frontend ``src/features/ai/agent/actionSummary.ts``.
"""

from __future__ import annotations

import re
from typing import Any


def _preview_phrase(text: str | None, max_len: int = 48) -> str:
    if not text:
        return "a note"
    cleaned = " ".join(str(text).split()).strip()
    if not cleaned:
        return "a note"
    first = cleaned.split(".")[0].split("!")[0].split("?")[0].strip() or cleaned
    if len(first) <= max_len:
        return first
    return f"{first[: max_len - 1]}…"


def _about_suffix(text: str | None) -> str:
    phrase = _preview_phrase(text)
    if not phrase or phrase == "a note":
        return ""
    return f" about {phrase}"


def _about_suffix_from_topic(topic: str | None) -> str:
    """Like frontend aboutSuffix — topic is already a preview phrase."""
    if not topic or topic == "a note":
        return ""
    return f" about {topic}"


def _topic_from_prompt(user_prompt: str) -> str | None:
    trimmed = user_prompt.strip()
    if not trimmed:
        return None
    match = re.search(r"\b(?:about|of|regarding)\s+(.+)$", trimmed, flags=re.IGNORECASE)
    if match and match.group(1):
        return match.group(1).rstrip(".!?").strip() or None
    return None


def _relation_phrase(relation: str) -> str:
    return relation.replace("_", " ")


def _placement_phrase(placement: dict[str, Any]) -> str:
    mode = placement.get("mode")
    if mode == "viewport_default":
        return "to the viewport default position"
    if mode == "absolute":
        return f"to ({placement.get('x')}, {placement.get('y')})"
    relation = _relation_phrase(str(placement.get("relation", "near")))
    anchor = placement.get("anchor_element_id", "unknown")
    return f"{relation} textbox {anchor}"


def _normalize_op(op: Any) -> dict[str, Any]:
    if isinstance(op, dict):
        return op
    if hasattr(op, "model_dump"):
        return op.model_dump()
    return dict(op)  # type: ignore[arg-type]


def summarize_operations(
    user_prompt: str,
    operations: list[dict[str, Any]] | list[Any],
    *,
    element_previews: dict[str, str] | None = None,
    created_ids: list[str] | None = None,
) -> str:
    """Compact one-line action summary for interaction memory."""
    ops = [_normalize_op(op) for op in operations]
    previews = element_previews or {}
    created = list(created_ids or [])

    if not ops:
        return "No canvas changes were applied."

    if len(ops) == 1:
        op = ops[0]
        op_type = op.get("type")
        if op_type == "create_text":
            element_id = created[0] if created else "new textbox"
            topic = _topic_from_prompt(user_prompt) or _preview_phrase(op.get("text"))
            placement = op.get("placement") or {}
            if isinstance(placement, dict) and placement.get("mode") == "relative_to_element":
                relation = _relation_phrase(str(placement.get("relation", "near")))
                anchor = placement.get("anchor_element_id", "unknown")
                return (
                    f"Created textbox {element_id} {relation} textbox {anchor} about {topic}."
                )
            return f"Created textbox {element_id} about {topic}."

        if op_type == "update_text":
            target = str(op.get("target_element_id", "unknown"))
            topic = _topic_from_prompt(user_prompt)
            if not topic and target in previews and previews.get(target):
                topic = _preview_phrase(previews.get(target))
            if not topic:
                topic = _preview_phrase(op.get("text"))
            return f"Updated textbox {target}{_about_suffix_from_topic(topic)}."

        if op_type == "move_text":
            target = str(op.get("target_element_id", "unknown"))
            placement = op.get("placement") or {}
            if not isinstance(placement, dict):
                placement = {}
            return f"Moved textbox {target} {_placement_phrase(placement)}."

        if op_type == "resize_text":
            target = str(op.get("target_element_id", "unknown"))
            width = op.get("width")
            height = op.get("height")
            if width is not None and height is not None:
                dims = f"{width} × {height}"
            else:
                parts: list[str] = []
                if width is not None:
                    parts.append(f"width {width}")
                if height is not None:
                    parts.append(f"height {height}")
                dims = ", ".join(parts)
            return f"Resized textbox {target} to {dims}."

        if op_type == "delete_text":
            target = str(op.get("target_element_id", "unknown"))
            prev = previews.get(target)
            return f"Deleted textbox {target}{_about_suffix(prev)}."

    parts: list[str] = []
    create_idx = 0
    for op in ops:
        op_type = op.get("type")
        if op_type == "create_text":
            element_id = created[create_idx] if create_idx < len(created) else "new textbox"
            create_idx += 1
            parts.append(f"created {element_id}")
        elif op_type == "update_text":
            parts.append(f"updated {op.get('target_element_id', 'unknown')}")
        elif op_type == "move_text":
            parts.append(f"moved {op.get('target_element_id', 'unknown')}")
        elif op_type == "resize_text":
            parts.append(f"resized {op.get('target_element_id', 'unknown')}")
        elif op_type == "delete_text":
            parts.append(f"deleted {op.get('target_element_id', 'unknown')}")

    if not parts:
        return "Applied canvas operations."
    if len(parts) == 1:
        return f"{parts[0][0].upper()}{parts[0][1:]}."
    head = [f"{parts[0][0].upper()}{parts[0][1:]}", *parts[1:-1]]
    return f"{', '.join(head)} and {parts[-1]}."
