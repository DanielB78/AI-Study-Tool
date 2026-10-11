"""Handwriting OCR package."""

from .trocr import (
    HandwritingRecognizer,
    MockHandwritingRecognizer,
    TrOCRHandwritingRecognizer,
    build_handwriting_recognizer,
    decode_data_url_or_base64,
    get_handwriting_recognizer,
    reset_handwriting_recognizer_cache,
)

__all__ = [
    "HandwritingRecognizer",
    "MockHandwritingRecognizer",
    "TrOCRHandwritingRecognizer",
    "build_handwriting_recognizer",
    "decode_data_url_or_base64",
    "get_handwriting_recognizer",
    "reset_handwriting_recognizer_cache",
]
