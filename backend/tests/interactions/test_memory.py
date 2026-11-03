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
from app.interactions.retrieval import InteractionRetrievalService
from app.interactions.schemas import InteractionCreateRequest
from app.interactions.service import InteractionMemoryService
from app.rag.similarity import cosine_similarity
from tests.rag.fake_embeddings import FakeSemanticEmbeddingService


def _db_available() -> bool:
    url = os.environ.get(
        "DATABASE_URL",
        "postgresql+psycopg://studyboard:studyboard@127.0.0.1:5432/studyboard",
    )
    try:
        engine = create_engine(url, future=True)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        engine.dispose()
        return True
    except Exception:
        return False


requires_db = pytest.mark.skipif(
    not _db_available(),
    reason="PostgreSQL not available for interaction memory integration tests",
)


@pytest.fixture()
def db_session() -> Session:
    if not _db_available():
        pytest.skip("PostgreSQL not available for interaction memory integration tests")
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
    return f"mem-board-{uuid.uuid4().hex[:10]}"


@pytest.fixture()
def fake_embedder() -> FakeSemanticEmbeddingService:
    return FakeSemanticEmbeddingService()


def test_max_of_prompt_and_summary_similarity() -> None:
    """Retrieval score is the max of prompt vs summary cosine similarities."""
    query = [1.0, 0.0, 0.0, 0.0]
    prompt_emb = [0.2, 0.8, 0.0, 0.0]
    summary_emb = [0.9, 0.1, 0.0, 0.0]
    prompt_sim = cosine_similarity(query, prompt_emb)
    summary_sim = cosine_similarity(query, summary_emb)
    assert max(prompt_sim, summary_sim) == summary_sim
    assert summary_sim > prompt_sim


@requires_db
@pytest.mark.asyncio
async def test_record_and_retrieve_by_prompt_and_summary(
    db_session: Session,
    board_id: str,
    fake_embedder: FakeSemanticEmbeddingService,
) -> None:
    settings = Settings(
        database_url=os.environ["DATABASE_URL"],
        embedding_provider="fake",
        embedding_model=fake_embedder.model,
        interaction_rag_top_k=5,
        interaction_rag_min_similarity=None,
    )
    service = InteractionMemoryService(
        db_session, settings=settings, embedding=fake_embedder
    )
    retrieval = InteractionRetrievalService(
        db_session, settings=settings, embedding=fake_embedder
    )

    await service.record_interaction(
        InteractionCreateRequest(
            board_id=board_id,
            user_prompt="Explain Gauss's law for spherical symmetry",
            action_summary="Created a note about electric flux and enclosed charge.",
            transaction_id="txn-gauss",
            created_element_ids=["textbox_1"],
        )
    )
    await service.record_interaction(
        InteractionCreateRequest(
            board_id=board_id,
            user_prompt="Plot Faraday induction examples",
            action_summary="Created a graph about electromagnetic induction.",
            transaction_id="txn-faraday",
            created_element_ids=["graph_1"],
        )
    )

    by_prompt = await retrieval.retrieve(
        board_id, "Gauss law spherical flux", top_k=2
    )
    assert by_prompt.matches
    assert "Gauss" in by_prompt.matches[0].user_prompt or "flux" in (
        by_prompt.matches[0].action_summary.lower()
    )

    by_summary = await retrieval.retrieve(
        board_id, "electromagnetic induction graph", top_k=2
    )
    assert by_summary.matches
    assert "induction" in by_summary.matches[0].action_summary.lower()


@requires_db
@pytest.mark.asyncio
async def test_retrieve_is_board_scoped(
    db_session: Session,
    fake_embedder: FakeSemanticEmbeddingService,
) -> None:
    settings = Settings(
        database_url=os.environ["DATABASE_URL"],
        embedding_provider="fake",
        embedding_model=fake_embedder.model,
        interaction_rag_top_k=5,
    )
    service = InteractionMemoryService(
        db_session, settings=settings, embedding=fake_embedder
    )
    retrieval = InteractionRetrievalService(
        db_session, settings=settings, embedding=fake_embedder
    )
    board_a = f"a-{uuid.uuid4().hex[:8]}"
    board_b = f"b-{uuid.uuid4().hex[:8]}"

    await service.record_interaction(
        InteractionCreateRequest(
            board_id=board_a,
            user_prompt="Gauss law lesson",
            action_summary="Wrote about enclosed charge.",
            transaction_id="txn-a",
        )
    )

    empty = await retrieval.retrieve(board_b, "Gauss law lesson", top_k=5)
    assert empty.matches == []
