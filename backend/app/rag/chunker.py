"""Sentence/paragraph-aware text chunking for RAG indexing.

Pure functions — no database dependency.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Tunable chunking configuration (also mirrored in Settings for runtime overrides).
SHORT_TEXT_THRESHOLD = 100
TARGET_CHUNK_WORDS = 75
CHUNK_OVERLAP_WORDS = 15

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[\"'“‘(\[]?[A-Z0-9])")
_WORD_RE = re.compile(r"\S+")


@dataclass(frozen=True)
class TextChunk:
    text: str
    chunk_index: int
    start_char: int
    end_char: int


@dataclass(frozen=True)
class _Span:
    """A contiguous slice of the original string (paragraph or sentence)."""

    start: int
    end: int
    text: str

    @property
    def word_count(self) -> int:
        return len(_WORD_RE.findall(self.text))


def count_words(text: str) -> int:
    return len(_WORD_RE.findall(text))


def normalize_text_for_hash(text: str) -> str:
    """Normalize only line endings — content identity must ignore geometry."""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _iter_paragraphs(text: str) -> list[_Span]:
    """Split on blank lines; keep single newlines inside a paragraph."""
    spans: list[_Span] = []
    # Split paragraphs on 2+ newlines but keep offsets against original.
    parts = re.split(r"(\n{2,})", text)
    cursor = 0
    buf_start: int | None = None
    buf_parts: list[str] = []

    def flush() -> None:
        nonlocal buf_start, buf_parts
        if buf_start is None:
            return
        joined = "".join(buf_parts)
        # Trim trailing whitespace for the span text, but keep offsets on original.
        stripped = joined.rstrip()
        if stripped.strip():
            # Adjust end if we stripped trailing whitespace from joined.
            end = buf_start + len(stripped)
            spans.append(_Span(start=buf_start, end=end, text=text[buf_start:end]))
        buf_start = None
        buf_parts = []

    for part in parts:
        if part == "":
            continue
        if re.fullmatch(r"\n{2,}", part):
            flush()
            cursor += len(part)
            continue
        if buf_start is None:
            buf_start = cursor
        buf_parts.append(part)
        cursor += len(part)
    flush()
    return spans


def _split_sentences(paragraph: _Span) -> list[_Span]:
    text = paragraph.text
    if not text.strip():
        return []
    # Keep separators by splitting with lookahead/lookbehind; rebuild offsets.
    pieces = _SENTENCE_SPLIT.split(text)
    if len(pieces) <= 1:
        return [paragraph]

    spans: list[_Span] = []
    # Re-find each piece in order within the paragraph.
    search_from = 0
    for piece in pieces:
        if not piece.strip():
            continue
        rel = text.find(piece, search_from)
        if rel < 0:
            rel = search_from
        start = paragraph.start + rel
        end = start + len(piece)
        spans.append(_Span(start=start, end=end, text=text[rel : rel + len(piece)]))
        search_from = rel + len(piece)
    return spans or [paragraph]


def _units_from_text(text: str) -> list[_Span]:
    units: list[_Span] = []
    for para in _iter_paragraphs(text):
        sentences = _split_sentences(para)
        units.extend(sentences)
    if not units and text.strip():
        # Fallback: whole non-empty text as one unit.
        stripped_start = len(text) - len(text.lstrip())
        stripped_end = len(text.rstrip())
        units.append(_Span(start=stripped_start, end=stripped_end, text=text[stripped_start:stripped_end]))
    return units


def _words_in_spans(spans: list[_Span]) -> int:
    return sum(s.word_count for s in spans)


def _join_spans(source: str, spans: list[_Span]) -> tuple[str, int, int]:
    if not spans:
        return "", 0, 0
    start = spans[0].start
    end = spans[-1].end
    return source[start:end], start, end


def _overlap_prefix(spans: list[_Span], overlap_words: int) -> list[_Span]:
    """Take a trailing slice of spans covering ~overlap_words (prefer whole spans)."""
    if overlap_words <= 0 or not spans:
        return []
    collected: list[_Span] = []
    words = 0
    for span in reversed(spans):
        collected.append(span)
        words += span.word_count
        if words >= overlap_words:
            break
    collected.reverse()
    return collected


def _pack_units(
    source: str,
    units: list[_Span],
    *,
    target_words: int,
    overlap_words: int,
) -> list[TextChunk]:
    chunks: list[TextChunk] = []
    i = 0
    n = len(units)
    while i < n:
        current: list[_Span] = []
        words = 0
        while i < n:
            nxt = units[i]
            nxt_words = nxt.word_count
            # Always take at least one unit.
            if current and words + nxt_words > target_words and words >= max(1, target_words // 2):
                break
            current.append(nxt)
            words += nxt_words
            i += 1
            if words >= target_words:
                break

        text, start, end = _join_spans(source, current)
        chunks.append(
            TextChunk(
                text=text,
                chunk_index=len(chunks),
                start_char=start,
                end_char=end,
            )
        )

        if i >= n:
            break

        # Overlap: rewind to include trailing spans covering ~overlap_words.
        overlap = _overlap_prefix(current, overlap_words)
        if not overlap:
            continue
        # Find first overlap unit index in units list and resume from there,
        # but skip if that would make no forward progress.
        first_overlap = overlap[0]
        resume = next((idx for idx, u in enumerate(units) if u.start == first_overlap.start and u.end == first_overlap.end), None)
        if resume is None or resume >= i:
            # Fallback: start next chunk at i (no overlap) to guarantee progress.
            continue
        # Ensure forward progress: next chunk must eventually consume unit at i-1 boundary.
        # Resume from the first overlap unit, but if resume == start of current chunk, nudge forward.
        chunk_start_idx = next(
            (idx for idx, u in enumerate(units) if u.start == current[0].start and u.end == current[0].end),
            i - len(current),
        )
        if resume <= chunk_start_idx:
            continue
        i = resume

    return chunks


def chunk_text(
    text: str,
    *,
    short_threshold: int = SHORT_TEXT_THRESHOLD,
    target_words: int = TARGET_CHUNK_WORDS,
    overlap_words: int = CHUNK_OVERLAP_WORDS,
) -> list[TextChunk]:
    """Chunk text using paragraph → sentence → word preference.

    - <= short_threshold words → single chunk
    - else pack ~target_words with ~overlap_words overlap
    """
    if text is None:
        return []
    if not text.strip():
        return []

    word_count = count_words(text)
    if word_count <= short_threshold:
        # Single chunk over the full original string (offsets cover whole input).
        # Prefer trimming only for stored text body while offsets map to content.
        start = 0
        end = len(text)
        # Keep exact original slice so start/end always slice back correctly.
        return [TextChunk(text=text[start:end], chunk_index=0, start_char=start, end_char=end)]

    units = _units_from_text(text)
    if not units:
        return []

    # If somehow a single unit is huge, fall back to word-boundary packing.
    chunks = _pack_units(
        text,
        units,
        target_words=target_words,
        overlap_words=overlap_words,
    )

    # Safety: if a chunk is still enormous because one sentence is huge, split by words.
    refined: list[TextChunk] = []
    for chunk in chunks:
        if count_words(chunk.text) <= target_words * 2:
            refined.append(chunk)
            continue
        refined.extend(
            _word_fallback_chunks(
                text,
                chunk.start_char,
                chunk.end_char,
                target_words=target_words,
                overlap_words=overlap_words,
                start_index=len(refined),
            )
        )
    # Re-index
    return [
        TextChunk(text=c.text, chunk_index=i, start_char=c.start_char, end_char=c.end_char)
        for i, c in enumerate(refined)
    ]


def _word_fallback_chunks(
    source: str,
    start: int,
    end: int,
    *,
    target_words: int,
    overlap_words: int,
    start_index: int,
) -> list[TextChunk]:
    region = source[start:end]
    words = list(_WORD_RE.finditer(region))
    if not words:
        return [TextChunk(text=region, chunk_index=start_index, start_char=start, end_char=end)]

    chunks: list[TextChunk] = []
    i = 0
    while i < len(words):
        j = min(i + target_words, len(words))
        w_start = words[i].start()
        w_end = words[j - 1].end()
        abs_start = start + w_start
        abs_end = start + w_end
        chunks.append(
            TextChunk(
                text=source[abs_start:abs_end],
                chunk_index=start_index + len(chunks),
                start_char=abs_start,
                end_char=abs_end,
            )
        )
        if j >= len(words):
            break
        # Overlap: step back overlap_words, but always advance at least 1 word.
        i = max(i + 1, j - overlap_words)
    return chunks
