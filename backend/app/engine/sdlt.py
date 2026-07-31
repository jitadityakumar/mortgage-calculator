"""
Stamp Duty Land Tax (England & Northern Ireland only — Scotland/Wales use
different taxes/bands). This is a one-off purchase cost, entirely separate
from the mortgage repayment math: it does not affect the loan principal or
amortization schedule. It's offered as a side-calculation so users can see
the real total cash needed at completion (property price + SDLT - deposit).

Rates current as of 1 April 2025 (unchanged into 2026). Verify against
https://www.gov.uk/stamp-duty-land-tax/residential-property-rates before
relying on this for a real transaction — bands are subject to change.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

from pydantic import BaseModel

from .money import js_round


class SdltBandBreakdown(BaseModel):
    bandLabel: str
    ratePct: float
    taxableAmount: float
    tax: float


class SdltResult(BaseModel):
    totalTax: float
    breakdown: list[SdltBandBreakdown]


@dataclass
class _Band:
    up_to: Optional[float]
    rate_pct: float
    label: str


STANDARD_BANDS: list[_Band] = [
    _Band(125_000, 0, "Up to £125,000"),
    _Band(250_000, 2, "£125,001–£250,000"),
    _Band(925_000, 5, "£250,001–£925,000"),
    _Band(1_500_000, 10, "£925,001–£1.5m"),
    _Band(None, 12, "Above £1.5m"),
]

FIRST_TIME_BUYER_BANDS: list[_Band] = [
    _Band(300_000, 0, "Up to £300,000"),
    _Band(500_000, 5, "£300,001–£500,000"),
]


def _apply_bands(property_value: float, bands: list[_Band]) -> SdltResult:
    breakdown: list[SdltBandBreakdown] = []
    remaining = property_value
    lower_bound = 0.0
    total_tax = 0.0

    for band in bands:
        if remaining <= 0:
            break
        band_ceiling = band.up_to if band.up_to is not None else math.inf
        band_size = band_ceiling - lower_bound
        taxable_amount = min(remaining, band_size)
        if taxable_amount > 0:
            tax = js_round(taxable_amount * (band.rate_pct / 100))
            breakdown.append(
                SdltBandBreakdown(
                    bandLabel=band.label,
                    ratePct=band.rate_pct,
                    taxableAmount=taxable_amount,
                    tax=tax,
                )
            )
            total_tax += tax
            remaining -= taxable_amount
        lower_bound = band_ceiling

    return SdltResult(totalTax=total_tax, breakdown=breakdown)


def calculate_sdlt(property_value: float, is_first_time_buyer: bool) -> SdltResult:
    if property_value <= 0:
        return SdltResult(totalTax=0, breakdown=[])
    if is_first_time_buyer and property_value <= 500_000:
        return _apply_bands(property_value, FIRST_TIME_BUYER_BANDS)
    return _apply_bands(property_value, STANDARD_BANDS)
