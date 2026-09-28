from __future__ import annotations

import os
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://studyboard:studyboard@127.0.0.1:5432/studyboard",
)
os.environ["EMBEDDING_PROVIDER"] = ""
os.environ["EMBEDDING_MODEL"] = ""
os.environ["HF_TOKEN"] = ""

from app.config import Settings, get_settings
from app.db.base import Base
from app.db.session import get_db_session, reset_db_caches
from app.interactions.schemas import InteractionCreateRequest
from app.interactions.service import InteractionMemoryService
from app.main import create_app
from tests.rag.fake_embeddings import FakeSemanticEmbeddingService


@pytest.fixture()
def db_session(monkeypatch: pytest.MonkeyPatch) -> Session:
    monkeypatch.setenv("EMBEDDING_PROVIDER", "")
    monkeypatch.setenv("EMBEDDING_MODEL", "")
    monkeypatch.setenv("HF_TOKEN", "")
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
    return f"rec-board-{uuid.uuid4().hex[:10]}"


@pytest.fixture()
def client(db_session: Session) -> TestClient:
    app = create_app()

    def override() -> Session:
        return db_session

    app.dependency_overrides[get_db_session] = override
    return TestClient(app)


@pytest.mark.asyncio
async def test_record_without_embedding(
    db_session: Session,
    board_id: str,
) -> None:
    settings = Settings(
        database_url=os.environ["DATABASE_URL"],
        embedding_provider="",
        embedding_model="",
    )
    service = InteractionMemoryService(db_session, settings=settings, embedding=None)
    result = await service.record_interaction(
        InteractionCreateRequest(
            board_id=board_id,
            user_prompt="Add a note about Gauss",
            transaction_id="tx-1",
            operations=[
                {
                    "type": "create_text",
                    "text": "Gauss law",
                    "placement": {"mode": "viewport_default"},
                }
            ],
            created_element_ids=["el-a"],
            affected_element_ids=["el-a"],
        )
    )
    assert result.embeddings_written is False
    assert result.action_summary
    recent = service.list_recent(board_id, limit=5)
    assert len(recent) == 1
    assert recent[0].transaction_id == "tx-1"
    assert recent[0].has_embedding is False


@pytest.mark.asyncio
async def test_record_with_embedding_and_status(
    db_session: Session,
    board_id: str,
) -> None:
    fake = FakeSemanticEmbeddingService()
    settings = Settings(
        database_url=os.environ["DATABASE_URL"],
        embedding_provider="fake",
        embedding_model=fake.model,
        recent_interaction_count=5,
    )
    service = InteractionMemoryService(db_session, settings=settings, embedding=fake)
    first = await service.record_interaction(
        InteractionCreateRequest(
            board_id=board_id,
            user_prompt="Gauss electric flux",
            transaction_id="tx-emb-1",
            action_summary="Created Gauss note.",
            operations=[],
            created_element_ids=["g1"],
            affected_element_ids=["g1"],
        )
    )
    assert first.embeddings_written is True
    assert first.embedding_model == fake.model

    await service.record_interaction(
        InteractionCreateRequest(
            board_id=board_id,
            user_prompt="duplicate-ish prompt",
            transaction_id="tx-emb-2",
            action_summary="Created another note.",
            operations=[],
        )
    )
    recent = service.list_recent(board_id, limit=10)
    assert len(recent) == 2
    # Dedup by transaction — two distinct txs.
    txs = {r.transaction_id for r in recent}
    assert txs == {"tx-emb-1", "tx-emb-2"}

    updated = service.set_status_by_transaction(board_id, "tx-emb-1", "undone")
    assert updated.status == "undone"
    redone = service.set_status_by_transaction(board_id, "tx-emb-1", "redone")
    assert redone.status == "redone"


def test_http_create_recent_status_and_intent(
    client: TestClient,
    board_id: str,
) -> None:
    res = client.post(
        "/api/interactions/",
        json={
            "board_id": board_id,
            "user_prompt": "Add Faraday note",
            "transaction_id": "http-tx-1",
            "operations": [
                {
                    "type": "create_text",
                    "text": "Faraday induction",
                    "placement": {"mode": "viewport_default"},
                }
            ],
            "created_element_ids": ["f1"],
            "affected_element_ids": ["f1"],
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["transaction_id"] == "http-tx-1"
    assert "Faraday" in data["action_summary"] or "f1" in data["action_summary"]

    recent = client.get(f"/api/interactions/boards/{board_id}/recent?limit=5")
    assert recent.status_code == 200
    assert len(recent.json()) == 1

    patched = client.patch(
        f"/api/interactions/boards/{board_id}/transactions/http-tx-1/status",
        json={"status": "undone"},
    )
    assert patched.status_code == 200
    assert patched.json()["status"] == "undone"

    intent = client.post("/api/interactions/intent/undo", json={"prompt": "undo that"})
    assert intent.status_code == 200
    assert intent.json()["intent"] == "undo"

    no_intent = client.post(
        "/api/interactions/intent/undo",
        json={"prompt": "explain what undo means"},
    )
    assert no_intent.status_code == 200
    assert no_intent.json()["intent"] is None


@pytest.mark.asyncio
async def test_rebuild_embeddings(
    db_session: Session,
    board_id: str,
) -> None:
    bare = InteractionMemoryService(
        db_session,
        settings=Settings(
            database_url=os.environ["DATABASE_URL"],
            embedding_provider="",
            embedding_model="",
        ),
        embedding=None,
    )
    await bare.record_interaction(
        InteractionCreateRequest(
            board_id=board_id,
            user_prompt="Gauss electric flux",
            transaction_id="tx-rebuild",
            action_summary="Created Gauss note.",
            operations=[],
        )
    )
    assert bare.list_recent(board_id)[0].has_embedding is False

    fake = FakeSemanticEmbeddingService()
    service = InteractionMemoryService(
        db_session,
        settings=Settings(
            database_url=os.environ["DATABASE_URL"],
            embedding_provider="fake",
            embedding_model=fake.model,
        ),
        embedding=fake,
    )
    rebuilt = await service.rebuild_embeddings_for_board(board_id)
    assert rebuilt.embeddings_written == 1
    assert service.list_recent(board_id)[0].has_embedding is True
