from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.calculate import router as calculate_router
from app.engine import MortgageValidationError

app = FastAPI(title="Mortgage Calculator API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(calculate_router)


@app.exception_handler(MortgageValidationError)
def handle_validation_error(request: Request, exc: MortgageValidationError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc), "issues": exc.issues})


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
