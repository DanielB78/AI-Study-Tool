"""Handwriting OCR + indexing HTTP routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...db.session import get_db_session
from ...errors import AiServiceError
from ..schemas import (
    HandwritingRecognizeRequest,
    HandwritingRecognizeResponse,
    HandwritingLineResult,
    HandwritingRegionIndexRequest,
    IndexElementResponse,
)
from ..service import RagIndexingService
from .trocr import (
    decode_data_url_or_base64,
    get_handwriting_recognizer,
)

router = APIRouter(prefix="/api/rag/handwriting", tags=["rag-handwriting"])


def get_rag_service(session: Session = Depends(get_db_session)) -> RagIndexingService:
    return RagIndexingService(session)


@router.get("/status")
async def handwriting_ocr_status() -> dict:
    recognizer = get_handwriting_recognizer()
    return {
        "provider": recognizer.provider,
        "model": recognizer.model_id,
        "ready": True,
    }


@router.post("/recognize", response_model=HandwritingRecognizeResponse)
async def recognize_handwriting_lines(
    body: HandwritingRecognizeRequest,
) -> HandwritingRecognizeResponse:
    """Run local TrOCR on each rendered handwriting line (top→bottom order)."""
    recognizer = get_handwriting_recognizer()
    line_results: list[HandwritingLineResult] = []
    combined_parts: list[str] = []
    any_failed = False

    for line in body.lines:
        try:
            image_bytes = decode_data_url_or_base64(line.image_data)
            if not image_bytes:
                line_results.append(
                    HandwritingLineResult(
                        line_id=line.line_id,
                        recognized_text="",
                        status="empty",
                    )
                )
                continue
            text = await recognizer.recognize_image(image_bytes)
            cleaned = (text or "").strip()
            if not cleaned:
                line_results.append(
                    HandwritingLineResult(
                        line_id=line.line_id,
                        recognized_text="",
                        status="empty",
                    )
                )
            else:
                line_results.append(
                    HandwritingLineResult(
                        line_id=line.line_id,
                        recognized_text=cleaned,
                        status="ready",
                    )
                )
                combined_parts.append(cleaned)
        except Exception as exc:  # noqa: BLE001 — surface per-line failure
            any_failed = True
            line_results.append(
                HandwritingLineResult(
                    line_id=line.line_id,
                    recognized_text="",
                    status="failed",
                    error=str(exc),
                )
            )

    combined = " ".join(combined_parts).strip()
    usable = bool(combined) and not (any_failed and not combined)
    if not combined and any_failed:
        status = "failed"
    elif not combined:
        status = "empty"
    else:
        status = "ready"

    return HandwritingRecognizeResponse(
        region_id=body.region_id,
        combined_text=combined,
        line_results=line_results,
        recognizer_model=recognizer.model_id,
        recognizer_provider=recognizer.provider,
        status=status,  # type: ignore[arg-type]
        usable_for_embedding=usable and status == "ready",
    )


@router.put("/elements", response_model=IndexElementResponse)
async def upsert_handwriting_region(
    body: HandwritingRegionIndexRequest,
    service: RagIndexingService = Depends(get_rag_service),
) -> IndexElementResponse:
    """Index recognized handwriting-region text via EmbeddingGemma (same path as text)."""
    if body.element_type not in {"handwriting_region", "text"}:
        raise AiServiceError(
            code="invalid_element_type",
            message="element_type must be handwriting_region",
            status_code=400,
        )
    # Force type for this endpoint.
    payload = body.model_copy(update={"element_type": "handwriting_region"})
    if not payload.text.strip():
        # Empty OCR → delete derived index; do not embed garbage.
        return await service.index_text_element(payload)
    return await service.index_text_element(payload)
