"""Pytest fixtures for the CampusIQ backend.

Each test gets a fresh isolated SQLite database (file-backed temp file so the
StaticPool sees the same DB across threads when FastAPI's TestClient hits it
from different worker threads). The FastAPI app is built once per session.
"""
from __future__ import annotations

import os
import tempfile
import uuid
from collections.abc import Generator, Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

# We must set env vars BEFORE importing app modules so config picks them up.
TMP_AUDIO_DIR = tempfile.mkdtemp(prefix="campusiq-test-audio-")
os.environ.setdefault("DATABASE_URL", "sqlite:///./_test_should_be_overridden.db")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-do-not-use-in-prod")
os.environ.setdefault("AUDIO_RETENTION_DAYS", "7")
os.environ.setdefault("AUDIO_CLEANUP_INTERVAL_HOURS", "0")  # disable loop in tests

from app.api.deps import DbSession, get_db  # noqa: E402
from app.core.database import Base  # noqa: E402
from app.main import app as fastapi_app  # noqa: E402


@pytest.fixture(scope="session")
def app_test_db_path() -> Iterator[Path]:
    """Create one shared temp SQLite DB for the whole session."""
    fd, path_str = tempfile.mkstemp(prefix="campusiq-test-", suffix=".db")
    os.close(fd)
    path = Path(path_str)
    yield path
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


@pytest.fixture(scope="session")
def engine(app_test_db_path: Path):
    eng = create_engine(
        f"sqlite:///{app_test_db_path}",
        connect_args={"check_same_thread": False},
        future=True,
    )
    # Ensure all model modules are imported so metadata is populated.
    import app.models  # noqa: F401

    Base.metadata.create_all(eng)

    # Repoint `app.core.database.SessionLocal` at the test engine so
    # background workers (e.g. notifications._retry_loop_tick) that
    # build their own session via `SessionLocal()` see the test tables
    # instead of the dummy DB the production module bound at import.
    from app.core import database as core_db

    original_factory = core_db.SessionLocal
    core_db.SessionLocal = sessionmaker(
        bind=eng, autoflush=False, autocommit=False, future=True
    )

    yield eng

    core_db.SessionLocal = original_factory
    eng.dispose()


@pytest.fixture()
def db_session(engine) -> Generator[Session, None, None]:
    """A clean DB session per test. Wipes all tables after each test."""
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
        # Truncate every table for the next test.
        with engine.begin() as conn:
            for table in reversed(Base.metadata.sorted_tables):
                conn.exec_driver_sql(f"DELETE FROM {table.name}")


@pytest.fixture()
def client(engine) -> Iterator[TestClient]:
    """A FastAPI TestClient that talks to the shared test DB."""
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)

    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    fastapi_app.dependency_overrides[get_db] = override_get_db
    with TestClient(fastapi_app) as c:
        yield c
    fastapi_app.dependency_overrides.pop(get_db, None)


def _signup_payload(role: str, suffix: str | None = None) -> dict:
    suffix = suffix or uuid.uuid4().hex[:8]
    return {
        "email": f"{role}-{suffix}@campusiq.dev",
        "password": "TestPass123",
        "full_name": f"{role.title()} {suffix}",
        "role": role,
    }


@pytest.fixture()
def signup_payload():
    """Factory that produces a fresh unique signup payload per call."""
    return _signup_payload
