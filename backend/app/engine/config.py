from __future__ import annotations

from typing import Optional

from .types import MortgageConfig, MortgageConfigOverrides

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


def resolve_config(overrides: Optional[MortgageConfigOverrides] = None) -> MortgageConfig:
    if overrides is None:
        return DEFAULT_CONFIG.model_copy()
    merged = DEFAULT_CONFIG.model_dump()
    for key, value in overrides.model_dump(exclude_none=True).items():
        merged[key] = value
    return MortgageConfig(**merged)
