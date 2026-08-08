import json

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.calculate import router as calculate_router
from app.api.saved import router as saved_router
from app.db import models  # noqa: F401 — registers SavedCalculation on Base.metadata
from app.db.models import DefaultsConfig
from app.db.session import Base, SessionLocal, engine
from app.engine import MortgageValidationError
from app.engine.config import load_seed_defaults

app = FastAPI(title="Mortgage Calculator API", version="1.0.0")

Base.metadata.create_all(bind=engine)

# Seed the single defaults_config row from the shipped defaults.json if
# missing — a fresh DB (or an existing pre-feature DB, which has no
# defaults_config table until create_all above just added it) needs a row
# before load_current_defaults() can read one. Done once, single-threaded,
# at startup rather than lazily inside a request, so there's no race with a
# concurrent first request.
with SessionLocal() as _db:
    if _db.get(DefaultsConfig, 1) is None:
        seed_payload = load_seed_defaults().model_dump(exclude={"updatedAt"})
        _db.add(DefaultsConfig(id=1, defaults_json=json.dumps(seed_payload)))
        _db.commit()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(calculate_router)
app.include_router(saved_router)


@app.exception_handler(MortgageValidationError)
def handle_validation_error(request: Request, exc: MortgageValidationError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc), "issues": exc.issues})


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
