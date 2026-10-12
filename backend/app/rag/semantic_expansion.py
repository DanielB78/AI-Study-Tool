"""Semantic knowledge expansion — anchor element → related canvas elements.

Distinct from prompt semantic retrieval. Operates on element-level vectors
(normalized mean of chunk embeddings). Debug/observational consumers only.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db.models import RagChunk
from ..errors import AiServiceError
from .embeddings.base import EmbeddingService, EmbeddingVector
from .repository import RagChunkRepository, embedding_as_list
from .similarity import cosine_similarity


SUPPORTED_ELEMENT_TYPES = frozenset({"text", "equation"})
MAX_DEPTH = 2
DEFAULT_DEPTH = 1
DEFAULT_MAX_NEIGHBOURS = 5
MIN_MAX_NEIGHBOURS = 1
MAX_MAX_NEIGHBOURS = 20


@dataclass(frozen=True)
class SemanticExpansionEdge:
    parent_element_id: str
    child_element_id: str
    root_anchor_element_id: str
    depth: int
    similarity: float


@dataclass
class ElementSemanticView:
    element_id: str
    element_type: str
    vector: EmbeddingVector
    preview: str
    geometry: dict[str, float]


@dataclass
class SemanticExpansionResult:
    board_id: str
    root_anchor_ids: list[str]
    depth: int
    max_neighbours: int
    embedding_model: str
    edges: list[SemanticExpansionEdge] = field(default_factory=list)
    elements: dict[str, ElementSemanticView] = field(default_factory=dict)
    unique_element_ids: list[str] = field(default_factory=list)


def _l2_normalize(vec: EmbeddingVector) -> EmbeddingVector:
    norm = math.sqrt(sum(x * x for x in vec))
    if norm <= 0.0:
        return list(vec)
    return [x / norm for x in vec]


def mean_chunk_embedding(chunks: list[RagChunk]) -> EmbeddingVector | None:
    """Normalized mean of chunk embeddings → element-level representation."""
    vectors: list[EmbeddingVector] = []
    for row in chunks:
        if row.embedding is None:
            continue
        vec = embedding_as_list(row.embedding)
        if vec is None:
            continue
        vectors.append(vec)
    if not vectors:
        return None
    dim = len(vectors[0])
    acc = [0.0] * dim
    for vec in vectors:
        if len(vec) != dim:
            continue
        for i, x in enumerate(vec):
            acc[i] += x
    n = float(len(vectors))
    return _l2_normalize([x / n for x in acc])


def build_element_views(
    rows: list[RagChunk],
) -> dict[str, ElementSemanticView]:
    by_element: dict[str, list[RagChunk]] = {}
    for row in rows:
        if row.element_type not in SUPPORTED_ELEMENT_TYPES:
            continue
        by_element.setdefault(row.element_id, []).append(row)

    views: dict[str, ElementSemanticView] = {}
    for element_id, chunks in by_element.items():
        vector = mean_chunk_embedding(chunks)
        if vector is None:
            continue
        chunks_sorted = sorted(chunks, key=lambda c: c.chunk_index)
        preview = " ".join(c.text for c in chunks_sorted).strip()
        if len(preview) > 160:
            preview = preview[:159] + "…"
        first = chunks_sorted[0]
        views[element_id] = ElementSemanticView(
            element_id=element_id,
            element_type=first.element_type,
            vector=vector,
            preview=preview,
            geometry={
                "x": first.x,
                "y": first.y,
                "width": first.width,
                "height": first.height,
            },
        )
    return views


def neighbours_of(
    anchor_id: str,
    views: dict[str, ElementSemanticView],
    *,
    max_neighbours: int,
    exclude: set[str],
) -> list[tuple[str, float]]:
    anchor = views.get(anchor_id)
    if anchor is None:
        return []
    scored: list[tuple[str, float]] = []
    for other_id, other in views.items():
        if other_id == anchor_id or other_id in exclude:
            continue
        score = cosine_similarity(anchor.vector, other.vector)
        scored.append((other_id, score))
    scored.sort(key=lambda t: (-t[1], t[0]))
    return scored[: max(0, max_neighbours)]


def expand_from_views(
    views: dict[str, ElementSemanticView],
    root_anchor_ids: list[str],
    *,
    depth: int,
    max_neighbours: int,
) -> tuple[list[SemanticExpansionEdge], dict[str, ElementSemanticView]]:
    """Pure graph expansion over element vectors.

    - Path-based exclude prevents A→B→A loops.
    - Same child may appear under multiple roots/parents (separate edges).
    - Each (root, node) is expanded at most once (bounds depth-2 fan-out).
    """
    cleaned_roots = [a for a in root_anchor_ids if a in views]
    depth = max(0, min(MAX_DEPTH, int(depth)))
    max_neighbours = max(MIN_MAX_NEIGHBOURS, min(MAX_MAX_NEIGHBOURS, int(max_neighbours)))

    touched: dict[str, ElementSemanticView] = {
        rid: views[rid] for rid in cleaned_roots
    }
    if depth <= 0 or not cleaned_roots:
        return [], touched

    edges: list[SemanticExpansionEdge] = []
    # Frontier: (element_id, root_id, parent_depth, path_frozentuple)
    frontier: list[tuple[str, str, int, tuple[str, ...]]] = [
        (rid, rid, 0, (rid,)) for rid in cleaned_roots
    ]
    # Expand each node at most once per root to bound combinatorial growth.
    expanded: set[tuple[str, str]] = set()

    while frontier:
        parent_id, root_id, parent_depth, path = frontier.pop(0)
        next_depth = parent_depth + 1
        if next_depth > depth:
            continue
        expand_key = (root_id, parent_id)
        if expand_key in expanded:
            continue
        expanded.add(expand_key)

        path_set = set(path)
        hits = neighbours_of(
            parent_id,
            views,
            max_neighbours=max_neighbours,
            exclude=path_set,
        )
        for child_id, score in hits:
            edges.append(
                SemanticExpansionEdge(
                    parent_element_id=parent_id,
                    child_element_id=child_id,
                    root_anchor_element_id=root_id,
                    depth=next_depth,
                    similarity=score,
                )
            )
            touched[child_id] = views[child_id]
            if next_depth < depth and (root_id, child_id) not in expanded:
                frontier.append(
                    (child_id, root_id, next_depth, path + (child_id,))
                )

    return edges, touched


class SemanticExpansionService:
    """Expand from selected prompt-semantic anchors via element embeddings."""

    def __init__(
        self,
        session: Session,
        settings: Settings | None = None,
        embedding: EmbeddingService | None = None,
    ) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.repo = RagChunkRepository(session)
        self.embedding = embedding

    def _require_model(self) -> str:
        if self.embedding is not None:
            return self.embedding.model
        if self.settings.has_embedding_config:
            return self.settings.embedding_model
        raise AiServiceError(
            "Embedding is not configured.",
            code="embedding_not_configured",
            status_code=503,
        )

    def expand(
        self,
        *,
        board_id: str,
        root_anchor_ids: list[str],
        depth: int,
        max_neighbours: int,
    ) -> SemanticExpansionResult:
        cleaned_roots = [a.strip() for a in root_anchor_ids if a and a.strip()]
        depth = max(0, min(MAX_DEPTH, int(depth)))
        max_neighbours = max(
            MIN_MAX_NEIGHBOURS, min(MAX_MAX_NEIGHBOURS, int(max_neighbours))
        )

        model = self._require_model()
        rows = self.repo.list_embedded_for_board(board_id, embedding_model=model)
        views = build_element_views(rows)

        edges, touched = expand_from_views(
            views,
            cleaned_roots,
            depth=depth,
            max_neighbours=max_neighbours,
        )

        addition_ids = sorted({e.child_element_id for e in edges})
        return SemanticExpansionResult(
            board_id=board_id,
            root_anchor_ids=cleaned_roots,
            depth=depth,
            max_neighbours=max_neighbours,
            embedding_model=model,
            edges=edges,
            elements=touched,
            unique_element_ids=addition_ids,
        )
