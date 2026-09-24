"""Query / prompt processing for retrieval (chunking is the exception)."""

from __future__ import annotations

from dataclasses import dataclass

from .chunker import TextChunk, chunk_text, count_words

QUERY_LONG_PROMPT_THRESHOLD_WORDS = 200
QUERY_TARGET_CHUNK_WORDS = 125
QUERY_CHUNK_OVERLAP_WORDS = 20


@dataclass(frozen=True)
class QueryChunk:
    text: str
    chunk_index: int
    start_char: int
    end_char: int


def process_prompt(
    prompt: str,
    *,
    long_threshold: int = QUERY_LONG_PROMPT_THRESHOLD_WORDS,
    target_words: int = QUERY_TARGET_CHUNK_WORDS,
    overlap_words: int = QUERY_CHUNK_OVERLAP_WORDS,
) -> list[QueryChunk]:
    """Most prompts stay as a single query; only long prompts are sentence-chunked."""
    if prompt is None or not prompt.strip():
        return []

    words = count_words(prompt)
    if words <= long_threshold:
        return [
            QueryChunk(
                text=prompt,
                chunk_index=0,
                start_char=0,
                end_char=len(prompt),
            )
        ]

    chunks = chunk_text(
        prompt,
        short_threshold=long_threshold,
        target_words=target_words,
        overlap_words=overlap_words,
    )
    return [
        QueryChunk(
            text=c.text,
            chunk_index=c.chunk_index,
            start_char=c.start_char,
            end_char=c.end_char,
        )
        for c in chunks
    ]
