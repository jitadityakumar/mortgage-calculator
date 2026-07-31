from __future__ import annotations

from .types import MortgageInputs


def _is_integer(x: float) -> bool:
    return float(x).is_integer()


def validate_inputs(inputs: MortgageInputs) -> list[str]:
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
