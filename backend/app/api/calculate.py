from fastapi import APIRouter

from app.engine import (
    DEFAULTS,
    ComparisonResult,
    MortgageDefaults,
    MortgageInputs,
    MortgageResult,
    calculate_mortgage,
    compare_with_and_without_overpayments,
)

router = APIRouter(prefix="/api/v1", tags=["calculate"])


@router.post("/calculate", response_model=MortgageResult)
def calculate(inputs: MortgageInputs) -> MortgageResult:
    return calculate_mortgage(inputs)


@router.post("/compare", response_model=ComparisonResult)
def compare(inputs: MortgageInputs) -> ComparisonResult:
    return compare_with_and_without_overpayments(inputs)


@router.get("/defaults", response_model=MortgageDefaults)
def get_defaults() -> MortgageDefaults:
    # Single source of truth (defaults.json) — both the /calculate default-
    # filling (resolve_mortgage_inputs) and the frontend's form pre-fill
    # read from this same object, so they can never drift.
    return DEFAULTS
