from __future__ import annotations

from app.rag.query_processor import (
    QUERY_LONG_PROMPT_THRESHOLD_WORDS,
    process_prompt,
)
from app.rag.chunker import count_words


def _words(n: int, prefix: str = "w") -> str:
    return " ".join(f"{prefix}{i}" for i in range(n))


def test_short_prompt_is_one_query_chunk() -> None:
    prompt = "Explain Gauss's law and spherical symmetry"
    chunks = process_prompt(prompt)
    assert len(chunks) == 1
    assert chunks[0].chunk_index == 0
    assert chunks[0].text == prompt


def test_exactly_200_words_is_one_chunk() -> None:
    prompt = _words(QUERY_LONG_PROMPT_THRESHOLD_WORDS)
    assert count_words(prompt) == 200
    chunks = process_prompt(prompt)
    assert len(chunks) == 1


def test_long_prompt_produces_multiple_ordered_chunks() -> None:
    sentences = [
        f"Sentence {i} discusses electromagnetism with several careful words."
        for i in range(40)
    ]
    prompt = " ".join(sentences)
    assert count_words(prompt) > QUERY_LONG_PROMPT_THRESHOLD_WORDS
    chunks = process_prompt(prompt)
    assert len(chunks) >= 2
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))
    for c in chunks:
        assert prompt[c.start_char : c.end_char] == c.text


def test_empty_prompt() -> None:
    assert process_prompt("") == []
    assert process_prompt("   ") == []
