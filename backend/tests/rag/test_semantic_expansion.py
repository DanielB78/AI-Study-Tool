"""Unit tests for SemanticExpansionService pure graph logic."""

from __future__ import annotations

import pytest

from app.rag.semantic_expansion import (
    ElementSemanticView,
    expand_from_views,
    neighbours_of,
)


def _view(element_id: str, vector: list[float]) -> ElementSemanticView:
    return ElementSemanticView(
        element_id=element_id,
        element_type="text",
        vector=vector,
        preview=element_id,
        geometry={"x": 0.0, "y": 0.0, "width": 10.0, "height": 10.0},
    )


def _depth1_views() -> dict[str, ElementSemanticView]:
    """A→B=0.90, A→C=0.80, A→D=0.40 (unit vectors)."""
    return {
        "A": _view("A", [1.0, 0.0, 0.0, 0.0]),
        "B": _view("B", [0.9, 0.4358898943540673, 0.0, 0.0]),
        "C": _view("C", [0.8, 0.6, 0.0, 0.0]),
        "D": _view("D", [0.4, 0.916515138991168, 0.0, 0.0]),
    }


def test_depth1_max_neighbours_two():
    views = _depth1_views()
    hits = neighbours_of("A", views, max_neighbours=2, exclude=set())
    assert [h[0] for h in hits] == ["B", "C"]
    assert hits[0][1] == pytest.approx(0.9, abs=1e-6)
    assert hits[1][1] == pytest.approx(0.8, abs=1e-6)

    edges, _touched = expand_from_views(
        views, ["A"], depth=1, max_neighbours=2
    )
    children = [e.child_element_id for e in edges]
    assert children == ["B", "C"]
    assert all(e.depth == 1 for e in edges)
    assert "D" not in children


def test_depth2_expands_through_neighbours():
    # Custom graph via vectors:
    # A near B,C; B near D,E; C far from D,E
    views = {
        "A": _view("A", [1.0, 0.0, 0.0]),
        "B": _view("B", [0.95, 0.3122, 0.0]),
        "C": _view("C", [0.9, 0.0, 0.4359]),
        "D": _view("D", [0.85, 0.5268, 0.0]),
        "E": _view("E", [0.8, 0.6, 0.0]),
    }
    edges, _ = expand_from_views(views, ["A"], depth=2, max_neighbours=2)
    by_parent: dict[str, list[str]] = {}
    for e in edges:
        by_parent.setdefault(e.parent_element_id, []).append(e.child_element_id)

    assert set(by_parent["A"]) == {"B", "C"}
    # Depth-2 from B should include D/E (closest to B besides A which is on path)
    assert "D" in by_parent.get("B", []) or "E" in by_parent.get("B", [])
    depth2 = [e for e in edges if e.depth == 2]
    assert depth2
    assert all(e.root_anchor_element_id == "A" for e in edges)


def test_loop_prevention_ab():
    views = {
        "A": _view("A", [1.0, 0.0]),
        "B": _view("B", [0.99, 0.14106735979665894]),
    }
    edges, _ = expand_from_views(views, ["A"], depth=2, max_neighbours=5)
    # A → B only; B must not re-add A
    assert [(e.parent_element_id, e.child_element_id) for e in edges] == [
        ("A", "B")
    ]


def test_multiple_roots_both_connect_to_c():
    # A and B both close to C; tree may show both edges; unique ids once.
    views = {
        "A": _view("A", [1.0, 0.0, 0.0]),
        "B": _view("B", [0.0, 1.0, 0.0]),
        "C": _view("C", [0.7071, 0.7071, 0.0]),
        "Z": _view("Z", [0.0, 0.0, 1.0]),
    }
    edges, _ = expand_from_views(
        views, ["A", "B"], depth=1, max_neighbours=2
    )
    pairs = {(e.parent_element_id, e.child_element_id) for e in edges}
    assert ("A", "C") in pairs
    assert ("B", "C") in pairs
    unique_children = {e.child_element_id for e in edges}
    assert "C" in unique_children


def test_depth0_no_edges():
    views = _depth1_views()
    edges, touched = expand_from_views(
        views, ["A"], depth=0, max_neighbours=5
    )
    assert edges == []
    assert list(touched.keys()) == ["A"]


def test_self_match_excluded():
    views = _depth1_views()
    hits = neighbours_of("A", views, max_neighbours=10, exclude=set())
    assert all(h[0] != "A" for h in hits)
