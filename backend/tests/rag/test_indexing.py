from __future__ import annotations

import os
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

# Ensure DB URL before app imports settings cache in some paths.
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://studyboard:studyboard@127.0.0.1:5432/studyboard",
)

from app.config import get_settings
from app.db.base import Base
from app.db.session import get_db_session, reset_db_caches
from app.main import create_app
from app.rag.hashing import content_hash
from app.rag.schemas import TextElementIndexRequest
from app.rag.service import RagIndexingService


@pytest.fixture()
def db_session() -> Session:
    get_settings.cache_clear()
    reset_db_caches()
    settings = get_settings()
    assert settings.has_database_url
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
    return f"test-board-{uuid.uuid4().hex[:12]}"


@pytest.fixture()
def client(db_session: Session) -> TestClient:
    app = create_app()

    def override() -> Session:
        return db_session

    app.dependency_overrides[get_db_session] = override
    return TestClient(app)


def _payload(board_id: str, element_id: str, text: str, **geo: float) -> dict:
    return {
        "board_id": board_id,
        "element_id": element_id,
        "element_type": "text",
        "text": text,
        "x": geo.get("x", 10.0),
        "y": geo.get("y", 20.0),
        "width": geo.get("width", 400.0),
        "height": geo.get("height", 180.0),
    }


def test_new_element_creates_chunks(client: TestClient, board_id: str, db_session: Session) -> None:
    body = _payload(board_id, "el-1", "Gauss's law relates flux to enclosed charge.")
    res = client.put("/api/rag/elements/text", json=body)
    assert res.status_code == 200
    data = res.json()
    assert data["chunk_count"] == 1
    assert data["content_changed"] is True

    listed = client.get(f"/api/rag/boards/{board_id}/chunks").json()
    assert len(listed) == 1
    assert listed[0]["element_id"] == "el-1"
    assert listed[0]["x"] == 10.0


def test_unchanged_content_does_not_recreate(client: TestClient, board_id: str) -> None:
    body = _payload(board_id, "el-2", "Stable note content stays the same.")
    first = client.put("/api/rag/elements/text", json=body).json()
    second = client.put("/api/rag/elements/text", json=body).json()
    assert first["content_changed"] is True
    assert second["content_changed"] is False
    assert second["chunk_count"] == first["chunk_count"]


def test_text_change_replaces_chunks(client: TestClient, board_id: str) -> None:
    body = _payload(board_id, "el-3", "Original text about fields.")
    client.put("/api/rag/elements/text", json=body)
    body["text"] = "Updated text about potentials and fields together."
    res = client.put("/api/rag/elements/text", json=body).json()
    assert res["content_changed"] is True
    chunks = client.get(f"/api/rag/boards/{board_id}/chunks").json()
    assert all(c["element_id"] == "el-3" for c in chunks)
    assert any("Updated text" in c["text"] for c in chunks)
    assert not any("Original text" in c["text"] for c in chunks)


def test_move_only_updates_geometry(client: TestClient, board_id: str) -> None:
    text = "Move me without rechunking this exact content hash body."
    body = _payload(board_id, "el-4", text, x=1, y=2)
    client.put("/api/rag/elements/text", json=body)
    before = client.get(f"/api/rag/boards/{board_id}/chunks").json()
    digest = before[0]["content_hash"]

    body["x"] = 99
    body["y"] = 88
    res = client.put("/api/rag/elements/text", json=body).json()
    assert res["content_changed"] is False

    after = client.get(f"/api/rag/boards/{board_id}/chunks").json()
    assert after[0]["x"] == 99
    assert after[0]["y"] == 88
    assert after[0]["content_hash"] == digest
    assert after[0]["text"] == before[0]["text"]


def test_resize_only_via_geometry_endpoint(client: TestClient, board_id: str) -> None:
    body = _payload(board_id, "el-5", "Resize geometry only please.")
    client.put("/api/rag/elements/text", json=body)
    res = client.patch(
        f"/api/rag/elements/{board_id}/el-5/geometry",
        json={"x": 5, "y": 6, "width": 500, "height": 220},
    )
    assert res.status_code == 200
    assert res.json()["updated"] >= 1
    chunk = client.get(f"/api/rag/boards/{board_id}/chunks").json()[0]
    assert chunk["width"] == 500
    assert chunk["height"] == 220
    assert chunk["text"] == "Resize geometry only please."


def test_empty_text_removes_chunks(client: TestClient, board_id: str) -> None:
    body = _payload(board_id, "el-6", "Temporary note")
    client.put("/api/rag/elements/text", json=body)
    body["text"] = "   "
    res = client.put("/api/rag/elements/text", json=body).json()
    assert res["chunk_count"] == 0
    assert client.get(f"/api/rag/boards/{board_id}/chunks").json() == []


def test_delete_element(client: TestClient, board_id: str) -> None:
    client.put("/api/rag/elements/text", json=_payload(board_id, "el-7", "Delete me"))
    res = client.delete(f"/api/rag/elements/{board_id}/el-7")
    assert res.status_code == 200
    assert res.json()["deleted"] >= 1
    assert client.get(f"/api/rag/boards/{board_id}/chunks").json() == []


def test_multiple_elements_keep_association(client: TestClient, board_id: str) -> None:
    client.put("/api/rag/elements/text", json=_payload(board_id, "a", "Alpha note one"))
    client.put("/api/rag/elements/text", json=_payload(board_id, "b", "Beta note two"))
    chunks = client.get(f"/api/rag/boards/{board_id}/chunks").json()
    assert {c["element_id"] for c in chunks} == {"a", "b"}


def test_reindex_board(client: TestClient, board_id: str) -> None:
    client.put("/api/rag/elements/text", json=_payload(board_id, "old", "Will be replaced"))
    res = client.post(
        f"/api/rag/boards/{board_id}/reindex",
        json={
            "elements": [
                _payload(board_id, "n1", "New one"),
                _payload(board_id, "n2", "New two"),
            ]
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["element_count"] == 2
    assert body["chunk_count"] >= 2
    ids = {c["element_id"] for c in client.get(f"/api/rag/boards/{board_id}/chunks").json()}
    assert ids == {"n1", "n2"}


def test_content_hash_ignores_geometry() -> None:
    assert content_hash("same") == content_hash("same")
    assert content_hash("same\r\nline") == content_hash("same\nline")


def test_missing_database_url_returns_clear_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "")
    get_settings.cache_clear()
    reset_db_caches()
    app = create_app()
    client = TestClient(app)
    res = client.put(
        "/api/rag/elements/text",
        json=_payload("b", "e", "hi"),
    )
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "missing_database_url"
    get_settings.cache_clear()
    reset_db_caches()


def test_long_element_multiple_chunks(client: TestClient, board_id: str) -> None:
    sentences = [f"Sentence {i} explains electromagnetism with several useful words." for i in range(35)]
    text = " ".join(sentences)
    res = client.put("/api/rag/elements/text", json=_payload(board_id, "long", text)).json()
    assert res["chunk_count"] >= 2
    chunks = client.get(f"/api/rag/boards/{board_id}/chunks").json()
    assert [c["chunk_index"] for c in chunks] == list(range(len(chunks)))
    for c in chunks:
        assert text[c["start_char"] : c["end_char"]] == c["text"]
