from __future__ import annotations

from app.rag.chunker import (
    CHUNK_OVERLAP_WORDS,
    SHORT_TEXT_THRESHOLD,
    TARGET_CHUNK_WORDS,
    chunk_text,
    count_words,
)


def _words(n: int, prefix: str = "word") -> str:
    return " ".join(f"{prefix}{i}" for i in range(n))


def test_empty_and_whitespace() -> None:
    assert chunk_text("") == []
    assert chunk_text("   \n\t  ") == []


def test_short_texts_are_single_chunk() -> None:
    for n in (20, 99, 100):
        text = _words(n)
        chunks = chunk_text(text)
        assert len(chunks) == 1
        assert chunks[0].chunk_index == 0
        assert chunks[0].text == text
        assert chunks[0].start_char == 0
        assert chunks[0].end_char == len(text)
        assert text[chunks[0].start_char : chunks[0].end_char] == chunks[0].text


def test_long_text_produces_multiple_chunks_with_overlap() -> None:
    # Build many short sentences so sentence packing engages.
    sentences = [f"Sentence number {i} discusses a physics idea carefully." for i in range(40)]
    text = " ".join(sentences)
    assert count_words(text) > SHORT_TEXT_THRESHOLD

    chunks = chunk_text(text)
    assert len(chunks) >= 2
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))

    # No words disappear: reconstruction via offsets covers full range monotonically.
    for c in chunks:
        assert text[c.start_char : c.end_char] == c.text
        assert count_words(c.text) > 0

    # Approximate overlap: consecutive chunks share some words.
    first_words = set(chunks[0].text.split())
    second_words = set(chunks[1].text.split())
    assert len(first_words & second_words) >= max(1, CHUNK_OVERLAP_WORDS // 3)


def test_paragraph_boundaries_preferred() -> None:
    para1 = _words(40, "alpha") + "."
    para2 = _words(40, "beta") + "."
    text = f"{para1}\n\n{para2}"
    chunks = chunk_text(text, short_threshold=50, target_words=45, overlap_words=5)
    assert len(chunks) >= 2
    # First chunk should not bleed deep into second paragraph if packing works.
    assert "alpha0" in chunks[0].text
    assert chunks[0].text.count("beta") < chunks[-1].text.count("beta")


def test_sentence_boundaries_preferred_over_mid_sentence_split() -> None:
    s1 = "Electric fields can often be calculated using Gauss's law when symmetry allows."
    s2 = "Otherwise one must integrate Coulomb's law carefully over the charge distribution."
    s3 = "Both approaches are common in introductory electromagnetism courses worldwide today."
    text = f"{s1} {s2} {s3} " + _words(80, "pad")
    chunks = chunk_text(text, short_threshold=30, target_words=40, overlap_words=8)
    assert len(chunks) >= 2
    # Avoid the classic mid-phrase cut if a sentence end is nearby.
    joined = " || ".join(c.text for c in chunks)
    assert "fields can often || be calculated" not in joined


def test_character_offsets_round_trip() -> None:
    text = "First paragraph stays together.\n\nSecond paragraph has more detail about ∇·E = ρ/ε₀."
    chunks = chunk_text(text, short_threshold=5, target_words=8, overlap_words=2)
    assert chunks
    for c in chunks:
        assert 0 <= c.start_char <= c.end_char <= len(text)
        assert text[c.start_char : c.end_char] == c.text


def test_unicode_and_symbols() -> None:
    text = "Ω resistance and ∇·E = ρ/ε₀ appear in Maxwell equations. " + _words(90, "u")
    chunks = chunk_text(text)
    assert chunks
    assert any("Ω" in c.text or "∇" in c.text or "ε₀" in c.text for c in chunks)
    for c in chunks:
        assert text[c.start_char : c.end_char] == c.text


def test_multiline_notes_preserve_order() -> None:
    lines = [f"Line {i} contains several useful study words here." for i in range(30)]
    text = "\n".join(lines)
    chunks = chunk_text(text)
    assert chunks[0].start_char <= chunks[-1].start_char
    for a, b in zip(chunks, chunks[1:]):
        assert a.chunk_index < b.chunk_index


def test_config_constants_exposed() -> None:
    assert SHORT_TEXT_THRESHOLD == 100
    assert TARGET_CHUNK_WORDS == 75
    assert CHUNK_OVERLAP_WORDS == 15
