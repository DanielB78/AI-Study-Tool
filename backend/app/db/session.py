from __future__ import annotations

from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from ..config import Settings, get_settings
from ..errors import AiServiceError


class DatabaseNotConfiguredError(AiServiceError):
    def __init__(self) -> None:
        super().__init__(
            "Database is not configured. Set DATABASE_URL on the backend.",
            code="missing_database_url",
            status_code=503,
            detail="DATABASE_URL is empty",
        )


@lru_cache
def get_engine() -> Engine:
    settings = get_settings()
    if not settings.has_database_url:
        raise DatabaseNotConfiguredError()
    return create_engine(
        settings.database_url,
        pool_pre_ping=True,
        future=True,
    )


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), autoflush=False, autocommit=False, future=True)


def get_db_session() -> Generator[Session, None, None]:
    """FastAPI dependency — yields a session, commits nothing automatically."""
    if not get_settings().has_database_url:
        raise DatabaseNotConfiguredError()
    factory = get_session_factory()
    session = factory()
    try:
        yield session
    finally:
        session.close()


def reset_db_caches() -> None:
    """Test helper: clear cached engine/session factory."""
    get_engine.cache_clear()
    get_session_factory.cache_clear()


def build_engine(settings: Settings) -> Engine:
    if not settings.has_database_url:
        raise DatabaseNotConfiguredError()
    return create_engine(settings.database_url, pool_pre_ping=True, future=True)
