from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from .types import MortgageConfig, MortgageConfigOverrides, MortgageDefaults, MortgageInputs

# The single source of truth for every default value in the engine — also
# served as-is to the frontend via GET /api/v1/defaults, so it never
# hand-duplicates a second copy of these numbers (see issue #5 follow-up).
_DEFAULTS_PATH = Path(__file__).with_name("defaults.json")
DEFAULTS = MortgageDefaults(**json.loads(_DEFAULTS_PATH.read_text()))

DEFAULT_CONFIG = DEFAULTS.config

DEFAULT_VARIABLE_RATE_PLACEHOLDER_PCT = DEFAULTS.variableRateAnnualPct
DEFAULT_REMORTGAGE_GAP_MONTHS = DEFAULTS.remortgageGapMonths
DEFAULT_SAVINGS_PAYOUT_INTERVAL_YEARS = DEFAULTS.savingsPayoutIntervalYears
DEFAULT_FIXED_RATE_ANNUAL_PCT = DEFAULTS.fixedRateAnnualPct
DEFAULT_FIXED_TERM_MONTHS = DEFAULTS.fixedTermMonths
DEFAULT_TOTAL_TERM_MONTHS = DEFAULTS.totalTermMonths
DEFAULT_DEPOSIT = DEFAULTS.deposit
DEFAULT_OVERPAYMENT_MODE = DEFAULTS.overpaymentMode
DEFAULT_MONTHLY_OVERPAYMENT_AMOUNT_MODE = DEFAULTS.monthlyOverpaymentAmountMode
DEFAULT_BANKED_SAVINGS_DESTINATION = DEFAULTS.bankedSavingsDestination


def resolve_config(overrides: Optional[MortgageConfigOverrides] = None) -> MortgageConfig:
    if overrides is None:
        return DEFAULT_CONFIG.model_copy()
    merged = DEFAULT_CONFIG.model_dump()
    for key, value in overrides.model_dump(exclude_none=True).items():
        merged[key] = value
    return MortgageConfig(**merged)


def resolve_mortgage_inputs(inputs: MortgageInputs) -> MortgageInputs:
    """Fills in every field with a value in defaults.json that was left
    unset (None), so a caller who only knows propertyValue can still get a
    usable estimate. Fields the caller did supply are left untouched."""
    updates: dict[str, object] = {}
    if inputs.deposit is None:
        updates["deposit"] = DEFAULT_DEPOSIT
    if inputs.fixedRateAnnualPct is None:
        updates["fixedRateAnnualPct"] = DEFAULT_FIXED_RATE_ANNUAL_PCT
    if inputs.fixedTermMonths is None:
        updates["fixedTermMonths"] = DEFAULT_FIXED_TERM_MONTHS
    if inputs.variableRateAnnualPct is None:
        updates["variableRateAnnualPct"] = DEFAULT_VARIABLE_RATE_PLACEHOLDER_PCT
    if inputs.totalTermMonths is None:
        updates["totalTermMonths"] = DEFAULT_TOTAL_TERM_MONTHS
    if inputs.overpaymentMode is None:
        updates["overpaymentMode"] = DEFAULT_OVERPAYMENT_MODE
    if inputs.monthlyOverpaymentAmountMode is None:
        updates["monthlyOverpaymentAmountMode"] = DEFAULT_MONTHLY_OVERPAYMENT_AMOUNT_MODE
    if inputs.bankedSavingsDestination is None:
        updates["bankedSavingsDestination"] = DEFAULT_BANKED_SAVINGS_DESTINATION
    if not updates:
        return inputs
    return inputs.model_copy(update=updates)
