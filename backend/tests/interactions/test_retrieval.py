from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://studyboard:studyboard@127.0.0.1:5432/studyboard",
)
os.environ["EMBEDDING_PROVIDER"] = "deterministic"
os.environ["EMBEDDING_MODEL"] = "deterministic-hash-v1"
os.environ["EMBEDDING_DIMENSION"] = "64"
os.environ["HF_TOKEN"] = ""

from app.config import Settings, get_settings
from app.db.base import Base
from app.db.session import reset_db_caches
from app.interactions.schemas import InteractionCreateRequest
from app.interactions.service import InteractionMemoryService
from app.interactions.retrieval import InteractionRetrievalService
from tests.rag.fake_embeddings import FakeSemanticEmbeddingService


@pytest.fixture()
def db_session() -> Session:
    get_settings.cache_clear()
    reset_db_caches()
    settings = get_settings()
    engine = create_engine(settings.database_url, future=True)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
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
    return f"ix-board-{uuid.uuid4().hex[:10]}"


@pytest.fixture()
def fake_embedder() -> FakeSemanticEmbeddingService:
    return FakeSemanticEmbeddingService()


def _create_payload(
    board_id: str,
    *,
    prompt: str,
    tx: str,
    summary: str | None = None,
    ops: list | None = None,
) -> InteractionCreateRequest:
    return InteractionCreateRequest(
        board_id=board_id,
        user_prompt=prompt,
        transaction_id=tx,
        action_summary=summary,
        operations=ops
        or [
            {
                "type": "create_text",
                "text": prompt,
                "placement": {"mode": "viewport_default"},
            }
        ],
        created_element_ids=[f"el-{tx}"],
        affected_element_ids=[f"el-{tx}"],
    )


@pytest.mark.asyncio
async def test_retrieve_returns_recent_and_historical(
    db_session: Session,
    board_id: str,
    fake_embedder: FakeSemanticEmbeddingService,
) -> None:
    settings = Settings(
        database_url=os.environ["DATABASE_URL"],
        embedding_provider="fake",
        embedding_model=fake_embedder.model,
        recent_interaction_count=2,
        interaction_rag_top_k=5,
        interaction_rag_min_similarity=None,
    )
    memory = InteractionMemoryService(db_session, settings=settings, embedding=fake_embedder)

    # Older interactions (should be historical candidates).
    await memory.record_interaction(
        _create_payload(
            board_id,
            prompt="Gauss's law and electric flux",
            tx="tx-old-gauss",
            summary="Created textbox about Gauss electric flux.",
        )
    )
    await memory.record_interaction(
        _create_payload(
            board_id,
            prompt="Faraday induction notes",
            tx="tx-old-faraday",
            summary="Created textbox about Faraday induction.",
        )
    )
    # Recent window (newest two).
    await memory.record_interaction(
        _create_payload(
            board_id,
            prompt="Schrodinger quantum notes",
            tx="tx-recent-1",
            summary="Created textbox about Schrodinger quantum.",
        )
    )
    await memory.record_interaction(
        _create_payload(
            board_id,
            prompt="misc other note",
            tx="tx-recent-2",
            summary="Created textbox about other topics.",
        )
    )

    retrieval = InteractionRetrievalService(
        db_session, settings=settings, embedding=fake_embedder
    )
    result = await retrieval.retrieve(
        board_id,
        "electric flux and enclosed charge",
        recent_count=2,
        top_k=5,
    )

    assert len(result.recent) == 2
    assert result.recent[0].transaction_id == "tx-recent-2"
    assert result.recent[1].transaction_id == "tx-recent-1"
    assert all(r.provenance == "recent" for r in result.recent)

    # Gauss should outrank Faraday among historical; recent ids excluded.
    recent_ids = {r.id for r in result.recent}
    assert all(h.id not in recent_ids for h in result.historical)
    assert result.historical
    assert "Gauss" in result.historical[0].user_prompt or "gauss" in result.historical[
        0
    ].action_summary.lower()
    assert result.historical[0].provenance == "historical"
    assert result.historical[0].similarity is not None


@pytest.mark.asyncio
async def test_selected_historical_ids_included(
    db_session: Session,
    board_id: str,
    fake_embedder: FakeSemanticEmbeddingService,
) -> None:
    settings = Settings(
        database_url=os.environ["DATABASE_URL"],
        embedding_provider="fake",
        embedding_model=fake_embedder.model,
        recent_interaction_count=1,
        interaction_rag_top_k=1,
    )
    memory = InteractionMemoryService(db_session, settings=settings, embedding=fake_embedder)
    first = await memory.record_interaction(
        _create_payload(
            board_id,
            prompt="Faraday induction",
            tx="tx-sel",
            summary="Created Faraday note.",
        )
    )
    await memory.record_interaction(
        _create_payload(
            board_id,
            prompt="newest",
            tx="tx-new",
            summary="Newest action.",
        )
    )

    retrieval = InteractionRetrievalService(
        db_session, settings=settings, embedding=fake_embedder
    )
    result = await retrieval.retrieve(
        board_id,
        "quantum schrodinger",
        recent_count=1,
        top_k=1,
        selected_historical_ids=[first.id],
    )
    selected = [h for h in result.historical if h.provenance == "selected"]
    assert any(h.id == first.id for h in selected)


@pytest.mark.asyncio
async def test_retrieve_without_embeddings_still_returns_recent(
    db_session: Session,
    board_id: str,
) -> None:
    settings = Settings(
        database_url=os.environ["DATABASE_URL"],
        embedding_provider="",
        embedding_model="",
        recent_interaction_count=3,
    )
    memory = InteractionMemoryService(db_session, settings=settings, embedding=None)
    await memory.record_interaction(
        _create_payload(board_id, prompt="hello", tx="tx-a", summary="Did hello.")
    )
    retrieval = InteractionRetrievalService(db_session, settings=settings, embedding=None)
    result = await retrieval.retrieve(board_id, "anything")
    assert len(result.recent) == 1
    assert result.historical == []
    assert result.embedding_model is None
