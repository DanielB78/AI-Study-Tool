from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db.session import get_db_session
from .retrieval import PromptRetrievalService
from .schemas import (
    BoardReindexRequest,
    BoardReindexResponse,
    DeleteElementResponse,
    GeometryUpdateRequest,
    GeometryUpdateResponse,
    IndexElementResponse,
    RagChunkView,
    RebuildEmbeddingsResponse,
    RetrieveRequest,
    RetrieveResponse,
    SemanticExpandRequest,
    SemanticExpandResponse,
    SemanticExpansionEdgeResponse,
    SemanticExpansionElementResponse,
    TextElementIndexRequest,
)
from .semantic_expansion import SUPPORTED_ELEMENT_TYPES, SemanticExpansionService
from .service import RagIndexingService

router = APIRouter(prefix="/api/rag", tags=["rag"])


def get_rag_service(session: Session = Depends(get_db_session)) -> RagIndexingService:
    return RagIndexingService(session)


def get_retrieval_service(session: Session = Depends(get_db_session)) -> PromptRetrievalService:
    return PromptRetrievalService(session)


def get_semantic_expansion_service(
    session: Session = Depends(get_db_session),
) -> SemanticExpansionService:
    return SemanticExpansionService(session)


@router.put("/elements/text", response_model=IndexElementResponse)
async def upsert_text_element(
    body: TextElementIndexRequest,
    service: RagIndexingService = Depends(get_rag_service),
) -> IndexElementResponse:
    return await service.index_text_element(body)


@router.patch(
    "/elements/{board_id}/{element_id}/geometry",
    response_model=GeometryUpdateResponse,
)
def patch_geometry(
    board_id: str,
    element_id: str,
    body: GeometryUpdateRequest,
    service: RagIndexingService = Depends(get_rag_service),
) -> GeometryUpdateResponse:
    return service.update_geometry(board_id, element_id, body)


@router.delete(
    "/elements/{board_id}/{element_id}",
    response_model=DeleteElementResponse,
)
def delete_element(
    board_id: str,
    element_id: str,
    service: RagIndexingService = Depends(get_rag_service),
) -> DeleteElementResponse:
    return service.delete_element(board_id, element_id)


@router.post("/boards/{board_id}/reindex", response_model=BoardReindexResponse)
async def reindex_board(
    board_id: str,
    body: BoardReindexRequest,
    service: RagIndexingService = Depends(get_rag_service),
) -> BoardReindexResponse:
    return await service.reindex_board(board_id, body)


@router.post(
    "/boards/{board_id}/embeddings/rebuild",
    response_model=RebuildEmbeddingsResponse,
)
async def rebuild_board_embeddings(
    board_id: str,
    service: RagIndexingService = Depends(get_rag_service),
) -> RebuildEmbeddingsResponse:
    return await service.rebuild_embeddings_for_board(board_id)


@router.post(
    "/elements/{board_id}/{element_id}/embeddings/rebuild",
    response_model=RebuildEmbeddingsResponse,
)
async def rebuild_element_embeddings(
    board_id: str,
    element_id: str,
    service: RagIndexingService = Depends(get_rag_service),
) -> RebuildEmbeddingsResponse:
    return await service.rebuild_embeddings_for_element(board_id, element_id)


@router.get("/boards/{board_id}/chunks", response_model=list[RagChunkView])
def list_board_chunks(
    board_id: str,
    service: RagIndexingService = Depends(get_rag_service),
) -> list[RagChunkView]:
    """Development helper to inspect stored chunks."""
    return service.list_board_chunks(board_id)


@router.post("/retrieve", response_model=RetrieveResponse)
async def retrieve(
    body: RetrieveRequest,
    service: PromptRetrievalService = Depends(get_retrieval_service),
) -> RetrieveResponse:
    """Semantic-only retrieval for development / debugging (not wired to the LLM)."""
    return await service.retrieve(body)


@router.post("/expand/semantic", response_model=SemanticExpandResponse)
def expand_semantic(
    body: SemanticExpandRequest,
    service: SemanticExpansionService = Depends(get_semantic_expansion_service),
) -> SemanticExpandResponse:
    """Anchor → related canvas elements (debug). Distinct from prompt retrieve."""
    result = service.expand(
        board_id=body.board_id,
        root_anchor_ids=body.root_anchor_ids,
        depth=body.depth,
        max_neighbours=body.max_neighbours,
    )
    return SemanticExpandResponse(
        board_id=result.board_id,
        root_anchor_ids=result.root_anchor_ids,
        depth=result.depth,
        max_neighbours=result.max_neighbours,
        embedding_model=result.embedding_model,
        supported_element_types=sorted(SUPPORTED_ELEMENT_TYPES),
        edges=[
            SemanticExpansionEdgeResponse(
                parent_element_id=e.parent_element_id,
                child_element_id=e.child_element_id,
                root_anchor_element_id=e.root_anchor_element_id,
                depth=e.depth,
                similarity=e.similarity,
            )
            for e in result.edges
        ],
        elements=[
            SemanticExpansionElementResponse(
                element_id=v.element_id,
                element_type=v.element_type,
                preview=v.preview,
                geometry=v.geometry,
            )
            for v in result.elements.values()
        ],
        unique_element_ids=result.unique_element_ids,
    )
