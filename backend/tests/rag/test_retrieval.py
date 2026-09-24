from __future__ import annotations

import os
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://studyboard:studyboard@127.0.0.1:5432/studyboard",
)

from app.config import Settings, get_settings
from app.db.base import Base
from app.db.session import get_db_session, reset_db_caches
from app.main import create_app
from app.rag.ranking import group_chunks_by_element, rank_chunks_by_similarity
from app.rag.retrieval import PromptRetrievalService
from app.rag.schemas import RetrieveRequest, TextElementIndexRequest
from app.rag.service import RagIndexingService
from app.rag.embeddings.base import EmbeddingVector
from tests.rag.fake_embeddings import FakeSemanticEmbeddingService


@pytest.fixture()
def db_session() -> Session:
    get_settings.cache_clear()
    reset_db_caches()
    settings = get_settings()
    engine = create_engine(settings.database_url, future=True)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    session = factory()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
        engine.dispose()
        reset_db_caches()
        get_settings.cache_clear()


@pytest.fixture()
def board_id() -> str:
    return f"ret-board-{uuid.uuid4().hex[:10]}"


@pytest.fixture()
def fake_embedder() -> FakeSemanticEmbeddingService:
    return FakeSemanticEmbeddingService()


def _el(board_id: str, element_id: str, text: str, **geo: float) -> TextElementIndexRequest:
    return TextElementIndexRequest(
        board_id=board_id,
        element_id=element_id,
        text=text,
        x=geo.get("x", 0.0),
        y=geo.get("y", 0.0),
        width=geo.get("width", 200.0),
        height=geo.get("height", 100.0),
    )


@pytest.mark.asyncio
async def test_retrieval_ranks_gauss_above_others(
    db_session: Session,
    board_id: str,
    fake_embedder: FakeSemanticEmbeddingService,
) -> None:
    settings = Settings(
        database_url=os.environ["DATABASE_URL"],
        embedding_provider="fake",
        embedding_model=fake_embedder.model,
        rag_chunk_top_k=10,
        rag_min_similarity=None,
    )
    indexer = RagIndexingService(db_session, settings=settings, embedding=fake_embedder)
    await indexer.index_text_element(
        _el(board_id, "A", "Gauss's law relates electric flux to enclosed charge.", x=1, y=1)
    )
    await indexer.index_text_element(
        _el(board_id, "B", "Faraday's law describes electromagnetic induction.", x=999, y=999)
    )
    await indexer.index_text_element(
        _el(board_id, "C", "The Schrödinger equation describes quantum state evolution.", x=50, y=50)
    )

    retrieval = PromptRetrievalService(db_session, settings=settings, embedding=fake_embedder)
    result = await retrieval.retrieve(
        RetrieveRequest(board_id=board_id, prompt="electric flux and enclosed charge")
    )

    assert result.query_chunks == 1
    assert result.min_similarity is None
    assert result.candidates
    assert result.candidates[0].element_id == "A"
    assert result.candidates[0].score >= result.candidates[-1].score
    # Geometry returned but must not affect ranking (B is far away).
    ids = [c.element_id for c in result.candidates]
    assert ids.index("A") < ids.index("B")


@pytest.mark.asyncio
async def test_board_filtering(
    db_session: Session,
    fake_embedder: FakeSemanticEmbeddingService,
) -> None:
    settings = Settings(
        database_url=os.environ["DATABASE_URL"],
        embedding_provider="fake",
        embedding_model=fake_embedder.model,
    )
    indexer = RagIndexingService(db_session, settings=settings, embedding=fake_embedder)
    await indexer.index_text_element(_el("board-a", "A1", "Gauss's law and electric flux"))
    await indexer.index_text_element(_el("board-b", "B1", "Gauss's law and electric flux"))

    retrieval = PromptRetrievalService(db_session, settings=settings, embedding=fake_embedder)
    result = await retrieval.retrieve(
        RetrieveRequest(board_id="board-a", prompt="electric flux")
    )
    assert all(c.element_id != "B1" for c in result.candidates)
    assert any(c.element_id == "A1" for c in result.candidates)


def test_group_by_element_uses_max_score() -> None:
    from app.rag.ranking import ChunkMatch

    matches = [
        ChunkMatch("1", "b", "el", "text", 0, "a", 0.5, 0, 0, 1, 1),
        ChunkMatch("2", "b", "el", "text", 1, "b", 0.9, 0, 0, 1, 1),
        ChunkMatch("3", "b", "other", "text", 0, "c", 0.7, 0, 0, 1, 1),
    ]
    candidates = group_chunks_by_element(matches)
    by_id = {c.element_id: c for c in candidates}
    assert by_id["el"].score == pytest.approx(0.9)
    assert len(by_id["el"].matched_chunks) == 2


def test_rank_top_k_and_optional_threshold() -> None:
    class Row:
        def __init__(self, id_: str, element_id: str, embedding: EmbeddingVector) -> None:
            self.id = id_
            self.board_id = "b"
            self.element_id = element_id
            self.element_type = "text"
            self.chunk_index = 0
            self.text = element_id
            self.embedding = embedding
            self.x = self.y = 0.0
            self.width = self.height = 1.0

    rows = [
        Row("1", "a", [1.0, 0.0]),
        Row("2", "b", [0.9, 0.1]),
        Row("3", "c", [0.0, 1.0]),
    ]
    ranked = rank_chunks_by_similarity(
        [[1.0, 0.0]],
        rows,  # type: ignore[arg-type]
        top_k=2,
        min_similarity=None,
    )
    assert len(ranked) == 2
    assert ranked[0].element_id == "a"

    filtered = rank_chunks_by_similarity(
        [[1.0, 0.0]],
        rows,  # type: ignore[arg-type]
        top_k=10,
        min_similarity=0.95,
    )
    assert all(m.similarity >= 0.95 for m in filtered)


@pytest.mark.asyncio
async def test_retrieve_endpoint_requires_embedding_config(db_session: Session) -> None:
    app = create_app()

    def override() -> Session:
        return db_session

    app.dependency_overrides[get_db_session] = override
    # Ensure settings have no embedding config for this app process.
    get_settings.cache_clear()
    client = TestClient(app)
    # Force empty embedding via env for dependency-built services — inject retrieval instead.
    from app.rag import routes as rag_routes

    settings = Settings(database_url=os.environ["DATABASE_URL"], embedding_provider="", embedding_model="")
    service = PromptRetrievalService(db_session, settings=settings)
    app.dependency_overrides[rag_routes.get_retrieval_service] = lambda: service

    res = client.post(
        "/api/rag/retrieve",
        json={"board_id": "b", "prompt": "gauss"},
    )
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "missing_embedding_config"
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_empty_prompt_rejected(
    db_session: Session,
    fake_embedder: FakeSemanticEmbeddingService,
) -> None:
    settings = Settings(
        database_url=os.environ["DATABASE_URL"],
        embedding_provider="fake",
        embedding_model=fake_embedder.model,
    )
    retrieval = PromptRetrievalService(db_session, settings=settings, embedding=fake_embedder)
    with pytest.raises(Exception) as exc:
        await retrieval.retrieve(RetrieveRequest(board_id="b", prompt="  "))
    assert "empty" in str(exc.value).lower() or getattr(exc.value, "code", "") == "invalid_prompt"


@pytest.mark.asyncio
async def test_geometry_only_does_not_clear_embeddings(
    db_session: Session,
    board_id: str,
    fake_embedder: FakeSemanticEmbeddingService,
) -> None:
    settings = Settings(
        database_url=os.environ["DATABASE_URL"],
        embedding_provider="fake",
        embedding_model=fake_embedder.model,
    )
    indexer = RagIndexingService(db_session, settings=settings, embedding=fake_embedder)
    first = await indexer.index_text_element(_el(board_id, "g1", "Gauss electric flux", x=1, y=1))
    assert first.content_changed is True
    assert first.embeddings_updated is True

    second = await indexer.index_text_element(_el(board_id, "g1", "Gauss electric flux", x=50, y=60))
    assert second.content_changed is False
    chunks = indexer.list_board_chunks(board_id)
    assert chunks[0].has_embedding is True
    assert chunks[0].x == 50.0
