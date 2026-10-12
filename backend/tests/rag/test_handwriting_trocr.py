"""Local TrOCR handwriting recognition + indexing tests (mock provider)."""

from __future__ import annotations

import base64
import os
import uuid

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://studyboard:studyboard@127.0.0.1:5432/studyboard",
)
os.environ["EMBEDDING_PROVIDER"] = ""
os.environ["EMBEDDING_MODEL"] = ""
os.environ["HF_TOKEN"] = ""
os.environ["HANDWRITING_OCR_PROVIDER"] = "mock"
os.environ["HANDWRITING_OCR_MODEL"] = "mock-trocr"

from app.config import get_settings
from app.main import create_app
from app.rag.handwriting.trocr import (
    MockHandwritingRecognizer,
    build_handwriting_recognizer,
    decode_data_url_or_base64,
    reset_handwriting_recognizer_cache,
)


TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
TINY_PNG_DATA_URL = f"data:image/png;base64,{TINY_PNG_B64}"


def _postgres_available() -> bool:
    try:
        import psycopg

        with psycopg.connect(
            "host=127.0.0.1 dbname=studyboard user=studyboard password=studyboard",
            connect_timeout=1,
        ):
            return True
    except Exception:
        return False


@pytest.fixture()
def ocr_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """Client for OCR routes that do not require a DB session."""
    monkeypatch.setenv("HANDWRITING_OCR_PROVIDER", "mock")
    monkeypatch.setenv("HANDWRITING_OCR_MODEL", "mock-trocr")
    monkeypatch.setenv("EMBEDDING_PROVIDER", "")
    monkeypatch.setenv("EMBEDDING_MODEL", "")
    get_settings.cache_clear()
    reset_handwriting_recognizer_cache()
    return TestClient(create_app())


def test_decode_data_url():
    raw = decode_data_url_or_base64(TINY_PNG_DATA_URL)
    assert raw == base64.b64decode(TINY_PNG_B64)
    assert decode_data_url_or_base64(TINY_PNG_B64) == raw


@pytest.mark.asyncio
async def test_mock_recognizer_returns_stable_text():
    rec = MockHandwritingRecognizer()
    text = await rec.recognize_image(base64.b64decode(TINY_PNG_B64))
    assert text == "mock handwriting"
    assert rec.provider == "mock"


def test_build_recognizer_respects_mock_provider(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("HANDWRITING_OCR_PROVIDER", "mock")
    get_settings.cache_clear()
    reset_handwriting_recognizer_cache()
    rec = build_handwriting_recognizer(get_settings())
    assert isinstance(rec, MockHandwritingRecognizer)


def test_ocr_status_endpoint(ocr_client: TestClient):
    res = ocr_client.get("/api/rag/handwriting/status")
    assert res.status_code == 200
    data = res.json()
    assert data["provider"] == "mock"
    assert data["model"] == "mock-trocr"
    assert data["ready"] is True


def test_recognize_multiline_combines_in_order(ocr_client: TestClient):
    res = ocr_client.post(
        "/api/rag/handwriting/recognize",
        json={
            "board_id": "b1",
            "region_id": "hw_abc",
            "lines": [
                {"line_id": "L1", "image_data": TINY_PNG_DATA_URL},
                {"line_id": "L2", "image_data": TINY_PNG_DATA_URL},
            ],
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ready"
    assert data["usable_for_embedding"] is True
    assert data["combined_text"] == "mock handwriting mock handwriting"
    assert len(data["line_results"]) == 2
    assert data["line_results"][0]["line_id"] == "L1"
    assert data["line_results"][0]["status"] == "ready"
    assert data["recognizer_provider"] == "mock"


def test_recognize_rejects_empty_lines_payload(ocr_client: TestClient):
    res = ocr_client.post(
        "/api/rag/handwriting/recognize",
        json={"region_id": "hw_empty", "lines": []},
    )
    assert res.status_code == 422


@pytest.mark.skipif(not _postgres_available(), reason="Postgres not available")
def test_index_handwriting_region(monkeypatch: pytest.MonkeyPatch) -> None:
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import Session, sessionmaker

    from app.db.base import Base
    from app.db.session import get_db_session, reset_db_caches

    monkeypatch.setenv("EMBEDDING_PROVIDER", "")
    monkeypatch.setenv("EMBEDDING_MODEL", "")
    monkeypatch.setenv("HANDWRITING_OCR_PROVIDER", "mock")
    get_settings.cache_clear()
    reset_db_caches()
    reset_handwriting_recognizer_cache()
    settings = get_settings()
    engine = create_engine(settings.database_url, future=True)
    with engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    session = factory()
    board_id = f"hw-board-{uuid.uuid4().hex[:12]}"
    try:
        app = create_app()

        def override() -> Session:
            return session

        app.dependency_overrides[get_db_session] = override
        client = TestClient(app)
        body = {
            "board_id": board_id,
            "element_id": "hw_testhash",
            "element_type": "handwriting_region",
            "text": "electric field decreases with distance",
            "x": 10.0,
            "y": 20.0,
            "width": 200.0,
            "height": 40.0,
            "element_revision": "abc123",
            "metadata": {"source_type": "handwriting_region"},
        }
        res = client.put("/api/rag/handwriting/elements", json=body)
        assert res.status_code == 200
        data = res.json()
        assert data["element_id"] == "hw_testhash"
        assert data["chunk_count"] == 1

        listed = client.get(f"/api/rag/boards/{board_id}/chunks").json()
        assert len(listed) == 1
        assert listed[0]["element_type"] == "handwriting_region"

        # Empty OCR deletes derived index
        res2 = client.put(
            "/api/rag/handwriting/elements",
            json={
                "board_id": board_id,
                "element_id": "hw_testhash",
                "element_type": "handwriting_region",
                "text": "   ",
                "x": 10.0,
                "y": 20.0,
                "width": 200.0,
                "height": 40.0,
            },
        )
        assert res2.status_code == 200
        assert res2.json()["chunk_count"] == 0
        assert client.get(f"/api/rag/boards/{board_id}/chunks").json() == []
    finally:
        session.rollback()
        session.close()
        engine.dispose()
        reset_db_caches()
        get_settings.cache_clear()
        reset_handwriting_recognizer_cache()
