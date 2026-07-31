import os
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker
from sqlalchemy.pool import StaticPool

# Docker Compose always sets DATABASE_URL (see docker-compose.yml). The
# file-based fallback is for running `uvicorn` directly without it.
#
# Deliberately NOT an in-memory default: FastAPI runs sync endpoints (all of
# these are `def`, not `async def`) in a threadpool, and an in-memory SQLite
# DB needs StaticPool (a single shared connection with thread-checking
# disabled) to survive across requests at all — which then makes concurrent
# requests genuinely unsafe to interleave on that one connection. A file-
# based DB doesn't have this problem: normal pooling hands each thread its
# own connection. Tests opt into the in-memory DB explicitly via
# tests/conftest.py (set before app.main is ever imported), rather than that
# being the silent default for anyone running the app directly.
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./mortgage.db")

engine_kwargs: dict = {"connect_args": {"check_same_thread": False}}
if DATABASE_URL == "sqlite:///:memory:":
    engine_kwargs["poolclass"] = StaticPool

engine = create_engine(DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
