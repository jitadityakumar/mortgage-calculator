from fastapi import APIRouter

from app.engine import (
    ComparisonResult,
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
