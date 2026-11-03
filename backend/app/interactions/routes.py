from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db.session import get_db_session
from .retrieval import InteractionRetrievalService
from .schemas import (
    InteractionCreateRequest,
    InteractionRecordResponse,
    InteractionRetrieveRequest,
    InteractionRetrieveResponse,
    RebuildInteractionEmbeddingsResponse,
)
from .service import InteractionMemoryService

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
    """Record an applied AI interaction (embed prompt + summary when configured)."""
    return await service.record_interaction(body)


@router.post(
    "/boards/{board_id}/retrieve",
    response_model=InteractionRetrieveResponse,
)
async def retrieve_interactions(
    board_id: str,
    body: InteractionRetrieveRequest,
    service: InteractionRetrievalService = Depends(get_interaction_retrieval_service),
) -> InteractionRetrieveResponse:
    """Top-k cosine retrieval over prompt and summary embeddings."""
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
