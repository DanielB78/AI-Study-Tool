from __future__ import annotations

from dataclasses import dataclass, field

from ..db.models import RagChunk
from .embeddings.base import EmbeddingVector
from .similarity import similarity


@dataclass
class ChunkMatch:
    chunk_id: str
    board_id: str
    element_id: str
    element_type: str
    chunk_index: int
    text: str
    similarity: float
    x: float
    y: float
    width: float
    height: float


@dataclass
class MatchedChunkView:
    chunk_index: int
    text: str
    similarity: float
    chunk_id: str


@dataclass
class ElementCandidate:
    element_id: str
    element_type: str
    score: float
    matched_chunks: list[MatchedChunkView] = field(default_factory=list)
    geometry: dict[str, float] = field(default_factory=dict)


def rank_chunks_by_similarity(
    query_vectors: list[EmbeddingVector],
    rows: list[RagChunk],
    *,
    metric: str = "cosine",
    top_k: int,
    min_similarity: float | None,
) -> list[ChunkMatch]:
    """Stage 1: embedding retrieval.

    For multi-query-chunk prompts, each document chunk keeps the MAX score
    across query vectors. Geometry is attached but never used for ranking.
    """
    if not query_vectors or not rows:
        return []

    best: dict[str, ChunkMatch] = {}
    for row in rows:
        if row.embedding is None:
            continue
        doc_vec = list(row.embedding)
        score = max(similarity(q, doc_vec, metric=metric) for q in query_vectors)
        key = str(row.id)
        existing = best.get(key)
        if existing is None or score > existing.similarity:
            best[key] = ChunkMatch(
                chunk_id=key,
                board_id=row.board_id,
                element_id=row.element_id,
                element_type=row.element_type,
                chunk_index=row.chunk_index,
                text=row.text,
                similarity=score,
                x=row.x,
                y=row.y,
                width=row.width,
                height=row.height,
            )

    ranked = sorted(best.values(), key=lambda m: m.similarity, reverse=True)
    if min_similarity is not None:
        ranked = [m for m in ranked if m.similarity >= min_similarity]
    if top_k > 0:
        ranked = ranked[:top_k]
    return ranked


def group_chunks_by_element(matches: list[ChunkMatch]) -> list[ElementCandidate]:
    """Stage 2: collapse chunk hits into TextElement candidates.

    element_score = max(chunk similarities) — do not average.
    Ready for a later cross-encoder / graph-expansion stage.
    """
    by_element: dict[str, ElementCandidate] = {}
    for match in matches:
        candidate = by_element.get(match.element_id)
        view = MatchedChunkView(
            chunk_index=match.chunk_index,
            text=match.text,
            similarity=match.similarity,
            chunk_id=match.chunk_id,
        )
        if candidate is None:
            by_element[match.element_id] = ElementCandidate(
                element_id=match.element_id,
                element_type=match.element_type,
                score=match.similarity,
                matched_chunks=[view],
                geometry={
                    "x": match.x,
                    "y": match.y,
                    "width": match.width,
                    "height": match.height,
                },
            )
        else:
            candidate.matched_chunks.append(view)
            if match.similarity > candidate.score:
                candidate.score = match.similarity
            # Geometry is parent-textbox geometry; keep latest seen (identical per element).
            candidate.geometry = {
                "x": match.x,
                "y": match.y,
                "width": match.width,
                "height": match.height,
            }

    candidates = list(by_element.values())
    for candidate in candidates:
        candidate.matched_chunks.sort(key=lambda c: c.similarity, reverse=True)
    candidates.sort(key=lambda c: c.score, reverse=True)
    return candidates
