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


def _placement_phrase(placement: dict[str, Any], noun: str = "textbox") -> str:
    mode = placement.get("mode")
    if mode == "viewport_default":
        return "to the viewport default position"
    if mode == "absolute":
        return f"to ({placement.get('x')}, {placement.get('y')})"
    relation = _relation_phrase(str(placement.get("relation", "near")))
    if placement.get("anchor_element_id"):
        anchor = placement.get("anchor_element_id", "unknown")
        return f"{relation} {noun} {anchor}"
    if placement.get("anchor_operation_index") is not None:
        return f"{relation} operation {placement.get('anchor_operation_index')}"
    return f"{relation} unknown anchor"


def _join_and(parts: list[str]) -> str:
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        return f"{parts[0]} and {parts[1]}"
    return f"{', '.join(parts[:-1])}, and {parts[-1]}"


def _summarize_style_patch(style: dict[str, Any]) -> str:
    parts: list[str] = []
    if "text_color" in style and style.get("text_color") is not None:
        parts.append(f"{style['text_color']} text")
    if "background_color" in style:
        bg = style.get("background_color")
        parts.append("transparent background" if bg is None else f"{bg} background")
    flags: list[str] = []
    if style.get("bold") is True:
        flags.append("bold")
    if style.get("bold") is False:
        flags.append("not bold")
    if style.get("italic") is True:
        flags.append("italic")
    if style.get("italic") is False:
        flags.append("not italic")
    if style.get("underline") is True:
        flags.append("underlined")
    if style.get("underline") is False:
        flags.append("not underlined")
    if flags:
        parts.append(", ".join(flags))
    if not parts:
        return "style unchanged"
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        return f"{parts[0]} and {parts[1]}"
    return f"{', '.join(parts[:-1])}, and {parts[-1]}"


def summarize_style_update(element_id: str, style: dict[str, Any]) -> str:
    """Natural one-line phrasing for a single update_text_style (mirrors frontend)."""
    has_color = "text_color" in style and style.get("text_color") is not None
    has_bg = "background_color" in style
    flags_on: list[str] = []
    flags_off: list[str] = []
    if style.get("bold") is True:
        flags_on.append("bold")
    if style.get("bold") is False:
        flags_off.append("not bold")
    if style.get("italic") is True:
        flags_on.append("italic")
    if style.get("italic") is False:
        flags_off.append("not italic")
    if style.get("underline") is True:
        flags_on.append("underlined")
    if style.get("underline") is False:
        flags_off.append("not underlined")

    if not has_color and not has_bg and flags_on and not flags_off:
        return f"Made textbox {element_id} {_join_and(flags_on)}."

    if has_color and not has_bg and not flags_on and not flags_off:
        return f"Changed textbox {element_id} to {style['text_color']} text."

    if not has_color and has_bg and not flags_on and not flags_off:
        bg = style.get("background_color")
        if bg is None:
            return f"Cleared textbox {element_id} background."
        return f"Filled textbox {element_id} {bg}."

    return f"Styled textbox {element_id}: {_summarize_style_patch(style)}."


def _normalize_op(op: Any) -> dict[str, Any]:
    if isinstance(op, dict):
        return op
    if hasattr(op, "model_dump"):
        # exclude_unset keeps background_color:null distinguishable from omitted
        return op.model_dump(exclude_unset=True)
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
                return (
                    f"Created textbox {element_id} {_placement_phrase(placement)} about {topic}."
                )
            return f"Created textbox {element_id} about {topic}."

        if op_type == "create_equation":
            element_id = created[0] if created else "new equation"
            topic = _topic_from_prompt(user_prompt) or _preview_phrase(op.get("latex"))
            placement = op.get("placement") or {}
            if isinstance(placement, dict) and placement.get("mode") == "relative_to_element":
                return (
                    f"Created equation {element_id} "
                    f"{_placement_phrase(placement, 'element')} ({topic})."
                )
            return f"Created equation {element_id} ({topic})."

        if op_type == "update_text":
            target = str(op.get("target_element_id", "unknown"))
            topic = _topic_from_prompt(user_prompt)
            if not topic and target in previews and previews.get(target):
                topic = _preview_phrase(previews.get(target))
            if not topic:
                topic = _preview_phrase(op.get("text"))
            return f"Updated textbox {target}{_about_suffix_from_topic(topic)}."

        if op_type == "update_equation":
            target = str(op.get("target_element_id", "unknown"))
            topic = _topic_from_prompt(user_prompt) or _preview_phrase(op.get("latex"))
            return f"Updated equation {target}{_about_suffix_from_topic(topic)}."

        if op_type == "move_text":
            target = str(op.get("target_element_id", "unknown"))
            placement = op.get("placement") or {}
            if not isinstance(placement, dict):
                placement = {}
            return f"Moved textbox {target} {_placement_phrase(placement)}."

        if op_type == "move_equation":
            target = str(op.get("target_element_id", "unknown"))
            placement = op.get("placement") or {}
            if not isinstance(placement, dict):
                placement = {}
            return f"Moved equation {target} {_placement_phrase(placement, 'element')}."

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

        if op_type == "resize_equation":
            target = str(op.get("target_element_id", "unknown"))
            width = op.get("width")
            height = op.get("height")
            if width is not None and height is not None:
                dims = f"{width} × {height}"
            else:
                parts = []
                if width is not None:
                    parts.append(f"width {width}")
                if height is not None:
                    parts.append(f"height {height}")
                dims = ", ".join(parts)
            return f"Resized equation {target} to {dims}."

        if op_type == "delete_text":
            target = str(op.get("target_element_id", "unknown"))
            prev = previews.get(target)
            return f"Deleted textbox {target}{_about_suffix(prev)}."

        if op_type == "delete_equation":
            target = str(op.get("target_element_id", "unknown"))
            prev = previews.get(target)
            return f"Deleted equation {target}{_about_suffix(prev)}."

        if op_type == "update_text_style":
            target = str(op.get("target_element_id", "unknown"))
            style = op.get("style") or {}
            if not isinstance(style, dict):
                style = {}
            return summarize_style_update(target, style)

    parts: list[str] = []
    create_idx = 0
    for op in ops:
        op_type = op.get("type")
        if op_type == "create_text":
            element_id = created[create_idx] if create_idx < len(created) else "new textbox"
            create_idx += 1
            parts.append(f"created {element_id}")
        elif op_type == "create_equation":
            element_id = created[create_idx] if create_idx < len(created) else "new equation"
            create_idx += 1
            parts.append(f"created equation {element_id}")
        elif op_type == "update_text":
            parts.append(f"updated {op.get('target_element_id', 'unknown')}")
        elif op_type == "update_equation":
            parts.append(f"updated equation {op.get('target_element_id', 'unknown')}")
        elif op_type == "move_text":
            parts.append(f"moved {op.get('target_element_id', 'unknown')}")
        elif op_type == "move_equation":
            parts.append(f"moved equation {op.get('target_element_id', 'unknown')}")
        elif op_type == "resize_text":
            parts.append(f"resized {op.get('target_element_id', 'unknown')}")
        elif op_type == "resize_equation":
            parts.append(f"resized equation {op.get('target_element_id', 'unknown')}")
        elif op_type == "delete_text":
            parts.append(f"deleted {op.get('target_element_id', 'unknown')}")
        elif op_type == "delete_equation":
            parts.append(f"deleted equation {op.get('target_element_id', 'unknown')}")
        elif op_type == "update_text_style":
            parts.append(f"styled {op.get('target_element_id', 'unknown')}")

    if not parts:
        return "Applied canvas operations."
    if len(parts) == 1:
        return f"{parts[0][0].upper()}{parts[0][1:]}."
    head = [f"{parts[0][0].upper()}{parts[0][1:]}", *parts[1:-1]]
    return f"{', '.join(head)} and {parts[-1]}."
