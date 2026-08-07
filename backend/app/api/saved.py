import json
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, StringConstraints, field_validator
from sqlalchemy.orm import Session

from app.db.models import SavedCalculation
from app.db.session import get_db
from app.engine.config import resolve_mortgage_inputs
from app.engine.types import MortgageInputs

router = APIRouter(prefix="/api/v1/saved-calculations", tags=["saved-calculations"])

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class SaveCalculationRequest(BaseModel):
    name: Name
    inputs: MortgageInputs


def _as_utc(dt: datetime) -> datetime:
    # SQLite's DATETIME column drops tzinfo on round-trip, so a naive
    # datetime read back from the DB is misread as local time once
    # serialized to JSON without an offset (e.g. by new Date() on the FE).
    # created_at is always written as UTC (see SavedCalculation.created_at),
    # so re-attach that explicitly rather than let it serialize as naive.
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


class SavedCalculationSummary(BaseModel):
    id: int
    name: str
    createdAt: datetime
    propertyValue: float
    deposit: float
    totalTermMonths: float

    _normalize_created_at = field_validator("createdAt", mode="before")(_as_utc)


class SavedCalculationDetail(BaseModel):
    id: int
    name: str
    createdAt: datetime
    inputs: MortgageInputs

    _normalize_created_at = field_validator("createdAt", mode="before")(_as_utc)


def _to_summary(row: SavedCalculation) -> SavedCalculationSummary:
    inputs = json.loads(row.inputs_json)
    return SavedCalculationSummary(
        id=row.id,
        name=row.name,
        createdAt=row.created_at,
        propertyValue=inputs["propertyValue"],
        deposit=inputs["deposit"],
        totalTermMonths=inputs["totalTermMonths"],
    )


def _get_or_404(db: Session, calculation_id: int) -> SavedCalculation:
    row = db.get(SavedCalculation, calculation_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Saved calculation not found.")
    return row


@router.post("", response_model=SavedCalculationSummary, status_code=201)
def create_saved_calculation(body: SaveCalculationRequest, db: Session = Depends(get_db)) -> SavedCalculationSummary:
    # Resolve deposit/rate/term defaults before persisting: a saved
    # calculation must always recompute the same result on load (see
    # get_saved_calculation), and SavedCalculationSummary's fields aren't
    # optional, so a partial-input save (now allowed by /calculate, issue
    # #5) must not be stored with nulls.
    resolved_inputs = resolve_mortgage_inputs(body.inputs)
    row = SavedCalculation(name=body.name, inputs_json=resolved_inputs.model_dump_json())
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_summary(row)


@router.get("", response_model=list[SavedCalculationSummary])
def list_saved_calculations(db: Session = Depends(get_db)) -> list[SavedCalculationSummary]:
    rows = (
        db.query(SavedCalculation)
        .order_by(SavedCalculation.created_at.desc(), SavedCalculation.id.desc())
        .all()
    )
    return [_to_summary(row) for row in rows]


@router.get("/{calculation_id}", response_model=SavedCalculationDetail)
def get_saved_calculation(calculation_id: int, db: Session = Depends(get_db)) -> SavedCalculationDetail:
    row = _get_or_404(db, calculation_id)
    return SavedCalculationDetail(
        id=row.id,
        name=row.name,
        createdAt=row.created_at,
        inputs=MortgageInputs(**json.loads(row.inputs_json)),
    )


@router.delete("/{calculation_id}", status_code=204)
def delete_saved_calculation(calculation_id: int, db: Session = Depends(get_db)) -> None:
    row = _get_or_404(db, calculation_id)
    db.delete(row)
    db.commit()
