from __future__ import annotations

from .types import MortgageDefaults, MortgageInputs


def _is_integer(x: float) -> bool:
    return float(x).is_integer()


def validate_inputs(inputs: MortgageInputs) -> list[str]:
    """Assumes `inputs` has already been through resolve_mortgage_inputs() —
    deposit/rate/term fields are typed Optional to support partial input
    from callers (issue #5), but this function reads them as plain floats,
    so a None here raises a TypeError rather than reporting a clean issue.
    calculate_mortgage() is the only caller and resolves first."""
    issues: list[str] = []

    if not (inputs.propertyValue > 0):
        issues.append("Property value must be greater than 0.")
    if inputs.deposit < 0:
        issues.append("Deposit cannot be negative.")
    if inputs.propertyValue > 0 and inputs.deposit >= inputs.propertyValue:
        issues.append("Deposit must be less than the property value (loan amount must be positive).")
    if inputs.fixedRateAnnualPct < 0:
        issues.append("Fixed rate cannot be negative.")
    if inputs.variableRateAnnualPct < 0:
        issues.append("Variable rate cannot be negative.")
    if not _is_integer(inputs.totalTermMonths) or inputs.totalTermMonths <= 0:
        issues.append("Total mortgage term must be a positive whole number of months.")
    if not _is_integer(inputs.fixedTermMonths) or inputs.fixedTermMonths < 0:
        issues.append("Fixed term must be a non-negative whole number of months.")
    if (
        _is_integer(inputs.totalTermMonths)
        and _is_integer(inputs.fixedTermMonths)
        and inputs.fixedTermMonths > inputs.totalTermMonths
    ):
        issues.append("Fixed term cannot be longer than the total mortgage term.")
    if inputs.fixedMonthlyOverpayment is not None and inputs.fixedMonthlyOverpayment < 0:
        issues.append("Fixed monthly overpayment cannot be negative.")
    if inputs.monthlySavings is not None and inputs.monthlySavings < 0:
        issues.append("Monthly savings cannot be negative.")
    if inputs.currentRent is not None and inputs.currentRent < 0:
        issues.append("Current rent cannot be negative.")
    if inputs.serviceCharge is not None and inputs.serviceCharge < 0:
        issues.append("Service charge cannot be negative.")
    if inputs.targetAllowanceUtilizationPct is not None and (
        inputs.targetAllowanceUtilizationPct < 0 or inputs.targetAllowanceUtilizationPct > 100
    ):
        issues.append("Target allowance utilization must be between 0 and 100%.")
    if inputs.remortgageGapMonths is not None and (
        not _is_integer(inputs.remortgageGapMonths) or inputs.remortgageGapMonths < 0
    ):
        issues.append("Remortgage gap must be a non-negative whole number of months.")
    if inputs.savingsPayoutIntervalYears is not None and inputs.savingsPayoutIntervalYears <= 0:
        issues.append("Savings payout interval must be greater than 0 years.")
    for i, lump in enumerate(inputs.lumpSums or []):
        if not (lump.amount > 0):
            issues.append(f"Lump sum #{i + 1}: amount must be greater than 0.")
        if not _is_integer(lump.atMonth) or lump.atMonth < 1:
            issues.append(f"Lump sum #{i + 1}: month must be a whole number ≥ 1.")

    return issues


def validate_defaults(d: MortgageDefaults) -> list[str]:
    """Guards the admin-editable defaults (PUT /api/v1/defaults) against
    values that would silently poison every partial /calculate request,
    saved-calculation resolution, and the FE's form pre-fill from then on —
    unlike a bad one-off /calculate call, a bad default persists until
    someone finds the admin page again. Mirrors validate_inputs' style;
    can't check deposit < propertyValue here since there's no propertyValue
    in this context — that stays a per-request check."""
    issues: list[str] = []

    if d.deposit < 0:
        issues.append("Default deposit cannot be negative.")
    if not (0 <= d.fixedRateAnnualPct <= 100):
        issues.append("Default fixed rate must be between 0 and 100%.")
    if not (0 <= d.variableRateAnnualPct <= 100):
        issues.append("Default variable rate must be between 0 and 100%.")
    if not _is_integer(d.totalTermMonths) or d.totalTermMonths <= 0:
        issues.append("Default total mortgage term must be a positive whole number of months.")
    if not _is_integer(d.fixedTermMonths) or d.fixedTermMonths < 0:
        issues.append("Default fixed term must be a non-negative whole number of months.")
    if (
        _is_integer(d.totalTermMonths)
        and _is_integer(d.fixedTermMonths)
        and d.fixedTermMonths > d.totalTermMonths
    ):
        issues.append("Default fixed term cannot be longer than the default total mortgage term.")
    if not _is_integer(d.remortgageGapMonths) or d.remortgageGapMonths < 0:
        issues.append("Default remortgage gap must be a non-negative whole number of months.")
    if d.savingsPayoutIntervalYears <= 0:
        issues.append("Default savings payout interval must be greater than 0 years.")
    if not (0 <= d.config.annualOverpaymentAllowancePct <= 100):
        issues.append("Default annual overpayment allowance must be between 0 and 100%.")
    if not (0 <= d.config.ercRateOnExcessPct <= 100):
        issues.append("Default ERC rate must be between 0 and 100%.")
    if d.config.arrangementFee < 0:
        issues.append("Default arrangement fee cannot be negative.")

    return issues
