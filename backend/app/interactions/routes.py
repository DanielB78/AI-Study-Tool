from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..db.session import get_db_session
from .retrieval import InteractionRetrievalService
from .schemas import (
    InteractionCreateRequest,
    InteractionRecordResponse,
    InteractionRetrieveRequest,
    InteractionRetrieveResponse,
    InteractionStatusUpdate,
    InteractionView,
    RebuildInteractionEmbeddingsResponse,
    UndoIntentRequest,
    UndoIntentResponse,
)
from .service import InteractionMemoryService
from .undo_intent import detect_undo_intent

router = APIRouter(prefix="/api/interactions", tags=["interactions"])


def get_interaction_service(
    session: Session = Depends(get_db_session),
) -> InteractionMemoryService:
    return InteractionMemoryService(session)


def get_interaction_retrieval_service(
    session: Session = Depends(get_db_session),
) -> InteractionRetrievalService:
    return InteractionRetrievalService(session)


@router.post("/", response_model=InteractionRecordResponse)
async def create_interaction(
    body: InteractionCreateRequest,
    service: InteractionMemoryService = Depends(get_interaction_service),
) -> InteractionRecordResponse:
    """Record an applied AI interaction (embed when configured)."""
    return await service.record_interaction(body)


@router.get("/boards/{board_id}/recent", response_model=list[InteractionView])
def list_recent_interactions(
    board_id: str,
    limit: int | None = Query(default=None, ge=1, le=50),
    service: InteractionMemoryService = Depends(get_interaction_service),
) -> list[InteractionView]:
    return service.list_recent(board_id, limit=limit)


@router.post(
    "/boards/{board_id}/retrieve",
    response_model=InteractionRetrieveResponse,
)
async def retrieve_interactions(
    board_id: str,
    body: InteractionRetrieveRequest,
    service: InteractionRetrievalService = Depends(get_interaction_retrieval_service),
) -> InteractionRetrieveResponse:
    return await service.retrieve_request(board_id, body)


@router.post(
    "/boards/{board_id}/embeddings/rebuild",
    response_model=RebuildInteractionEmbeddingsResponse,
)
async def rebuild_interaction_embeddings(
    board_id: str,
    service: InteractionMemoryService = Depends(get_interaction_service),
) -> RebuildInteractionEmbeddingsResponse:
    return await service.rebuild_embeddings_for_board(board_id)


@router.patch(
    "/boards/{board_id}/transactions/{transaction_id}/status",
    response_model=InteractionView,
)
def patch_transaction_status(
    board_id: str,
    transaction_id: str,
    body: InteractionStatusUpdate,
    service: InteractionMemoryService = Depends(get_interaction_service),
) -> InteractionView:
    return service.set_status_by_transaction(board_id, transaction_id, body.status)


@router.post("/intent/undo", response_model=UndoIntentResponse)
def undo_intent(body: UndoIntentRequest) -> UndoIntentResponse:
    return UndoIntentResponse(intent=detect_undo_intent(body.prompt))
