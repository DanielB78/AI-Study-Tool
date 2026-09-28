"""Format interaction memory sections for LLM system/user context."""

from __future__ import annotations

from typing import Any, Sequence


def _id_list(ids: Sequence[str] | None) -> str:
    if not ids:
        return "(none)"
    return ", ".join(str(i) for i in ids)


def _missing_note(
    affected: Sequence[str] | None,
    existing_element_ids: set[str] | None,
) -> str:
    if existing_element_ids is None or not affected:
        return ""
    missing = [eid for eid in affected if eid not in existing_element_ids]
    if not missing:
        return ""
    return f"\nMissing elements (no longer on board): {_id_list(missing)}"


def format_interaction_line(
    interaction: Any,
    *,
    existing_element_ids: set[str] | None = None,
    include_similarity: bool = False,
) -> str:
    """One compact block for a single interaction (no operations_json)."""
    prompt = getattr(interaction, "user_prompt", None) or ""
    summary = getattr(interaction, "action_summary", None) or ""
    status = getattr(interaction, "status", None) or "applied"
    affected = getattr(interaction, "affected_element_ids", None) or []
    created = getattr(interaction, "created_element_ids", None) or []
    updated = getattr(interaction, "updated_element_ids", None) or []
    interaction_id = str(getattr(interaction, "id", "") or "")
    tx = getattr(interaction, "transaction_id", None) or ""

    lines = [
        f"- id={interaction_id} tx={tx} status={status}",
        f"  User: {prompt.strip() or '(empty)'}",
        f"  Action: {summary.strip() or '(none)'}",
        f"  Affected: {_id_list(affected)}; created: {_id_list(created)}; updated: {_id_list(updated)}",
    ]
    missing = _missing_note(affected, existing_element_ids)
    if missing:
        lines.append(f"  {missing.strip()}")
    if include_similarity:
        sim = getattr(interaction, "similarity", None)
        if sim is not None:
            lines.append(f"  Similarity: {float(sim):.4f}")
    return "\n".join(lines)


def format_recent_section(
    interactions: Sequence[Any],
    *,
    existing_element_ids: set[str] | None = None,
) -> str:
    """LLM context block for the recent interaction window."""
    if not interactions:
        return "RECENT AI ACTIONS:\n(none)"
    body = "\n".join(
        format_interaction_line(item, existing_element_ids=existing_element_ids)
        for item in interactions
    )
    return f"RECENT AI ACTIONS:\n{body}"


def format_historical_section(
    interactions: Sequence[Any],
    *,
    existing_element_ids: set[str] | None = None,
) -> str:
    """LLM context block for semantically retrieved older interactions."""
    if not interactions:
        return "RELATED PAST AI ACTIONS:\n(none)"
    body = "\n".join(
        format_interaction_line(
            item,
            existing_element_ids=existing_element_ids,
            include_similarity=True,
        )
        for item in interactions
    )
    return f"RELATED PAST AI ACTIONS:\n{body}"


def format_interaction_context(
    *,
    recent: Sequence[Any],
    historical: Sequence[Any],
    existing_element_ids: set[str] | None = None,
) -> str:
    """Combine recent + historical sections for prompt injection."""
    return "\n\n".join(
        [
            format_recent_section(recent, existing_element_ids=existing_element_ids),
            format_historical_section(
                historical, existing_element_ids=existing_element_ids
            ),
        ]
    )
