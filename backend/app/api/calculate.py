from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.engine import (
    ComparisonResult,
    MortgageDefaults,
    MortgageInputs,
    MortgageResult,
    calculate_mortgage,
    compare_with_and_without_overpayments,
)
from app.engine.config import load_current_defaults, reset_defaults, update_defaults

router = APIRouter(prefix="/api/v1", tags=["calculate"])


@router.post("/calculate", response_model=MortgageResult)
def calculate(inputs: MortgageInputs, db: Session = Depends(get_db)) -> MortgageResult:
    return calculate_mortgage(inputs, load_current_defaults(db))


@router.post("/compare", response_model=ComparisonResult)
def compare(inputs: MortgageInputs, db: Session = Depends(get_db)) -> ComparisonResult:
    return compare_with_and_without_overpayments(inputs, load_current_defaults(db))


@router.get("/defaults", response_model=MortgageDefaults)
def read_defaults(db: Session = Depends(get_db)) -> MortgageDefaults:
    # Single source of truth (the defaults_config DB row) — both the
    # /calculate default-filling (resolve_mortgage_inputs) and the
    # frontend's form pre-fill read from this same object, so they can
    # never drift. Admin-editable via PUT below.
    return load_current_defaults(db)


@router.put("/defaults", response_model=MortgageDefaults)
def put_defaults(body: MortgageDefaults, db: Session = Depends(get_db)) -> MortgageDefaults:
    return update_defaults(db, body)


@router.post("/defaults/reset", response_model=MortgageDefaults)
def post_reset_defaults(db: Session = Depends(get_db)) -> MortgageDefaults:
    return reset_defaults(db)
