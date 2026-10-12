"""Local TrOCR handwriting recognition (microsoft/trocr-base-handwritten).

Runs entirely on-device via Hugging Face Transformers + Torch.
No cloud OCR APIs.
"""

from __future__ import annotations

import base64
import io
import logging
from abc import ABC, abstractmethod
from functools import lru_cache
from typing import Any

from ...config import Settings, get_settings

logger = logging.getLogger(__name__)


class HandwritingRecognizer(ABC):
    """Abstract handwriting OCR provider."""

    @property
    @abstractmethod
    def model_id(self) -> str: ...

    @property
    @abstractmethod
    def provider(self) -> str: ...

    @abstractmethod
    async def recognize_image(self, image_bytes: bytes) -> str:
        """Return recognized text for a single handwriting-line image."""


class MockHandwritingRecognizer(HandwritingRecognizer):
    """Deterministic stand-in for tests / when TrOCR is disabled."""

    def __init__(self, model_id: str = "mock-trocr") -> None:
        self._model_id = model_id

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def provider(self) -> str:
        return "mock"

    async def recognize_image(self, image_bytes: bytes) -> str:
        # Stable stub: never invent free-form OCR in tests.
        if not image_bytes:
            return ""
        return "mock handwriting"


class TrOCRHandwritingRecognizer(HandwritingRecognizer):
    """Lazy-loaded local TrOCR recognizer.

    Model is loaded once under a lock and reused for all subsequent lines.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._model_id = (settings.handwriting_ocr_model or "").strip()
        if not self._model_id:
            raise ValueError("HANDWRITING_OCR_MODEL must be set for TrOCR")
        self._processor: Any | None = None
        self._model: Any | None = None
        self._lock: Any | None = None
        self._device: str | None = None

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def provider(self) -> str:
        return "trocr"

    def _resolve_device(self) -> str:
        override = (self.settings.handwriting_ocr_device or "").strip().lower()
        if override:
            return override
        try:
            import torch

            if torch.cuda.is_available():
                return "cuda"
            if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
                return "mps"
        except Exception:
            pass
        return "cpu"

    def _load_sync(self) -> None:
        if self._model is not None and self._processor is not None:
            return
        from transformers import TrOCRProcessor, VisionEncoderDecoderModel

        device = self._resolve_device()
        logger.info("Loading TrOCR model %s on %s", self._model_id, device)
        token = self.settings.resolved_hf_token or None
        kwargs: dict[str, Any] = {}
        if token:
            kwargs["token"] = token
        self._processor = TrOCRProcessor.from_pretrained(self._model_id, **kwargs)
        self._model = VisionEncoderDecoderModel.from_pretrained(self._model_id, **kwargs)
        self._model.to(device)
        self._model.eval()
        self._device = device

    def _recognize_sync(self, image_bytes: bytes) -> str:
        from PIL import Image
        import torch

        self._load_sync()
        assert self._processor is not None and self._model is not None

        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        # Cap extreme widths while preserving aspect ratio.
        max_dim = max(64, int(self.settings.handwriting_ocr_max_dimension or 1024))
        w, h = image.size
        longest = max(w, h)
        if longest > max_dim:
            scale = max_dim / float(longest)
            image = image.resize(
                (max(1, int(w * scale)), max(1, int(h * scale))),
                Image.Resampling.LANCZOS,
            )

        pixel_values = self._processor(images=image, return_tensors="pt").pixel_values
        device = self._device or "cpu"
        pixel_values = pixel_values.to(device)
        with torch.no_grad():
            generated_ids = self._model.generate(pixel_values)
        text = self._processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
        return (text or "").strip()

    async def recognize_image(self, image_bytes: bytes) -> str:
        import asyncio

        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            return await asyncio.to_thread(self._recognize_sync, image_bytes)


def build_handwriting_recognizer(
    settings: Settings | None = None,
) -> HandwritingRecognizer:
    cfg = settings or get_settings()
    provider = (cfg.handwriting_ocr_provider or "trocr").strip().lower()
    if provider in {"mock", "fake", "none", "off"}:
        return MockHandwritingRecognizer(model_id=cfg.handwriting_ocr_model or "mock-trocr")
    if provider in {"trocr", "transformers", ""}:
        return TrOCRHandwritingRecognizer(cfg)
    raise ValueError(f"Unsupported HANDWRITING_OCR_PROVIDER: {provider}")


@lru_cache
def get_handwriting_recognizer() -> HandwritingRecognizer:
    return build_handwriting_recognizer()


def reset_handwriting_recognizer_cache() -> None:
    get_handwriting_recognizer.cache_clear()


def decode_data_url_or_base64(data: str) -> bytes:
    """Accept a data URL or raw base64 string and return image bytes."""
    raw = (data or "").strip()
    if not raw:
        return b""
    if raw.startswith("data:"):
        # data:image/png;base64,....
        comma = raw.find(",")
        if comma < 0:
            raise ValueError("invalid data URL")
        raw = raw[comma + 1 :]
    return base64.b64decode(raw)
