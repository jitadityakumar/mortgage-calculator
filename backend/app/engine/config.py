from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from .money import js_round
from .sdlt import calculate_sdlt
from .types import MortgageConfig, MortgageConfigOverrides, MortgageDefaults, MortgageInputs, MortgageValidationError
from .validate import validate_defaults

# The shipped fallback for every default value in the engine — the seed for
# a fresh defaults_config DB row (see app.main's startup seeding) and the
# restore target for POST /api/v1/defaults/reset. NOT the runtime source of
# truth once the app has booted — that's the DB row, admin-editable via
# PUT /api/v1/defaults (see load_current_defaults() below). Kept as a
# function (not a module-level constant) so tests and reset always get a
# fresh, independent copy.
_DEFAULTS_PATH = Path(__file__).with_name("defaults.json")


def load_seed_defaults() -> MortgageDefaults:
    return MortgageDefaults(**json.loads(_DEFAULTS_PATH.read_text()))


def load_current_defaults(db: Session) -> MortgageDefaults:
    """Reads the live, admin-editable defaults from the DB. No in-process
    caching: a single-row SELECT on local SQLite is negligible next to the
    amortization loop these endpoints already run, and caching here would
    both leak stale values across the test suite's per-test DBs and race
    under FastAPI's threadpool for sync endpoints. The row is expected to
    already exist (app.main seeds it at startup)."""
    from app.db.models import DefaultsConfig

    row = db.get(DefaultsConfig, 1)
    if row is None:
        # Defensive fallback (e.g. a test DB that skipped app startup) —
        # the DB row is still the intended runtime source once it exists.
        return load_seed_defaults()
    stored = json.loads(row.defaults_json)
    # Merge over the seed (one level deep, including `config`) so a row
    # written by an older app version — missing a field added to
    # MortgageDefaults *or* to the nested MortgageConfig since — doesn't 500
    # every endpoint. A shallow top-level-only merge would still let
    # `stored["config"]` fully replace the seed's config dict and drop a
    # newly-added MortgageConfig field, which Pydantic would then reject as
    # missing.
    seed = load_seed_defaults()
    merged = {**seed.model_dump(exclude={"updatedAt"}), **stored}
    merged["config"] = {**seed.config.model_dump(), **stored.get("config", {})}
    return MortgageDefaults(**merged, updatedAt=row.updated_at.isoformat())


def _persist_defaults(db: Session, new_defaults: MortgageDefaults) -> MortgageDefaults:
    from app.db.models import DefaultsConfig

    row = db.get(DefaultsConfig, 1)
    payload = new_defaults.model_dump(exclude={"updatedAt"})
    if row is None:
        row = DefaultsConfig(id=1, defaults_json=json.dumps(payload))
        db.add(row)
    else:
        row.defaults_json = json.dumps(payload)
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return MortgageDefaults(**payload, updatedAt=row.updated_at.isoformat())


def update_defaults(db: Session, new_defaults: MortgageDefaults) -> MortgageDefaults:
    issues = validate_defaults(new_defaults)
    if issues:
        raise MortgageValidationError(issues)
    return _persist_defaults(db, new_defaults)


def reset_defaults(db: Session) -> MortgageDefaults:
    return _persist_defaults(db, load_seed_defaults())


def resolve_config(
    overrides: Optional[MortgageConfigOverrides] = None,
    defaults: Optional[MortgageDefaults] = None,
) -> MortgageConfig:
    base_config = (defaults or load_seed_defaults()).config
    if overrides is None:
        return base_config.model_copy()
    merged = base_config.model_dump()
    for key, value in overrides.model_dump(exclude_none=True).items():
        merged[key] = value
    return MortgageConfig(**merged)


def resolve_mortgage_inputs(
    inputs: MortgageInputs,
    defaults: Optional[MortgageDefaults] = None,
) -> MortgageInputs:
    """Fills in every field with a value from `defaults` (falling back to
    the shipped defaults.json when not given) that was left unset (None), so
    a caller who only knows propertyValue can still get a usable estimate.
    Fields the caller did supply are left untouched. `deposit` is a special
    case: when `defaults.deriveDepositFromSavings` is on, it's derived as
    depositSavings minus SDLT(propertyValue, isFirstTimeBuyer) instead of
    using the flat `defaults.deposit` fallback — mirrors the frontend's
    updateDepositDriver()."""
    d = defaults or load_seed_defaults()
    updates: dict[str, object] = {}
    if inputs.deposit is None:
        if d.deriveDepositFromSavings:
            # Mirrors the frontend's updateDepositDriver()/buildDefaultFormState()
            # formula exactly (src/App.tsx, src/types/formState.ts), so a caller
            # who only supplies propertyValue gets the same deposit the calculator
            # would have pre-filled, not the flat `deposit` default underneath it.
            sdlt = calculate_sdlt(inputs.propertyValue, d.isFirstTimeBuyer)
            updates["deposit"] = max(0, js_round(d.depositSavings - sdlt.totalTax))
        else:
            updates["deposit"] = d.deposit
    if inputs.fixedRateAnnualPct is None:
        updates["fixedRateAnnualPct"] = d.fixedRateAnnualPct
    if inputs.fixedTermMonths is None:
        updates["fixedTermMonths"] = d.fixedTermMonths
    if inputs.variableRateAnnualPct is None:
        updates["variableRateAnnualPct"] = d.variableRateAnnualPct
    if inputs.totalTermMonths is None:
        updates["totalTermMonths"] = d.totalTermMonths
    if inputs.overpaymentMode is None:
        updates["overpaymentMode"] = d.overpaymentMode
    if inputs.currentRent is None:
        updates["currentRent"] = d.currentRent
    if inputs.monthlySavings is None:
        updates["monthlySavings"] = d.monthlySavings
    if inputs.serviceCharge is None:
        updates["serviceCharge"] = d.serviceCharge
    if inputs.monthlyOverpaymentAmountMode is None:
        updates["monthlyOverpaymentAmountMode"] = d.monthlyOverpaymentAmountMode
    if inputs.fixedMonthlyOverpayment is None:
        updates["fixedMonthlyOverpayment"] = d.fixedMonthlyOverpayment
    if inputs.targetAllowanceUtilizationPct is None:
        updates["targetAllowanceUtilizationPct"] = d.targetAllowanceUtilizationPct
    if inputs.bankedSavingsDestination is None:
        updates["bankedSavingsDestination"] = d.bankedSavingsDestination
    if inputs.rateAfterFixedTermMode is None:
        updates["rateAfterFixedTermMode"] = d.rateAfterFixedTermMode
    if not updates:
        return inputs
    return inputs.model_copy(update=updates)
