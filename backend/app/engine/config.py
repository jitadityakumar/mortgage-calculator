from __future__ import annotations

from typing import Optional

from .types import MortgageConfig, MortgageConfigOverrides, MortgageInputs

DEFAULT_CONFIG = MortgageConfig(
    annualOverpaymentAllowancePct=10,
    allowanceBasis="outstanding",
    ercRateOnExcessPct=3,
    ercAppliesDuringFixedTermOnly=True,
    arrangementFee=0,
    arrangementFeeAddedToLoan=False,
)

DEFAULT_VARIABLE_RATE_PLACEHOLDER_PCT = 7.25

DEFAULT_REMORTGAGE_GAP_MONTHS = 2

DEFAULT_SAVINGS_PAYOUT_INTERVAL_YEARS = 1

# Defaults for a "quick estimate from price alone" call to /calculate — mirror
# src/types/formState.ts's DEFAULT_FORM_STATE, which pre-fills the same
# fields for a brand-new form in the UI.
DEFAULT_FIXED_RATE_ANNUAL_PCT = 4.5
DEFAULT_FIXED_TERM_MONTHS = 60
DEFAULT_TOTAL_TERM_MONTHS = 300

# No universal "right" deposit exists for an unknown buyer, so this is a
# judgment call, not a mirrored FE value: 10% is a common minimum-deposit
# assumption for UK mortgages, and erring toward a smaller deposit gives a
# more conservative (larger loan, higher payment) affordability estimate.
DEFAULT_DEPOSIT_PCT_OF_PROPERTY_VALUE = 10


def resolve_config(overrides: Optional[MortgageConfigOverrides] = None) -> MortgageConfig:
    if overrides is None:
        return DEFAULT_CONFIG.model_copy()
    merged = DEFAULT_CONFIG.model_dump()
    for key, value in overrides.model_dump(exclude_none=True).items():
        merged[key] = value
    return MortgageConfig(**merged)


def resolve_mortgage_inputs(inputs: MortgageInputs) -> MortgageInputs:
    """Fills in deposit/rate/term fields left unset (None) with sensible
    defaults, so a caller who only knows propertyValue can still get a
    usable estimate. Fields the caller did supply are left untouched."""
    updates: dict[str, float] = {}
    if inputs.deposit is None:
        updates["deposit"] = round(inputs.propertyValue * DEFAULT_DEPOSIT_PCT_OF_PROPERTY_VALUE / 100, 2)
    if inputs.fixedRateAnnualPct is None:
        updates["fixedRateAnnualPct"] = DEFAULT_FIXED_RATE_ANNUAL_PCT
    if inputs.fixedTermMonths is None:
        updates["fixedTermMonths"] = DEFAULT_FIXED_TERM_MONTHS
    if inputs.variableRateAnnualPct is None:
        updates["variableRateAnnualPct"] = DEFAULT_VARIABLE_RATE_PLACEHOLDER_PCT
    if inputs.totalTermMonths is None:
        updates["totalTermMonths"] = DEFAULT_TOTAL_TERM_MONTHS
    if not updates:
        return inputs
    return inputs.model_copy(update=updates)
