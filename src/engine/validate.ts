import type { MortgageInputs } from './types';

export function validateInputs(inputs: MortgageInputs): string[] {
  const issues: string[] = [];

  if (!(inputs.propertyValue > 0)) {
    issues.push('Property value must be greater than 0.');
  }
  if (inputs.deposit < 0) {
    issues.push('Deposit cannot be negative.');
  }
  if (inputs.propertyValue > 0 && inputs.deposit >= inputs.propertyValue) {
    issues.push('Deposit must be less than the property value (loan amount must be positive).');
  }
  if (inputs.fixedRateAnnualPct < 0) {
    issues.push('Fixed rate cannot be negative.');
  }
  if (inputs.variableRateAnnualPct < 0) {
    issues.push('Variable rate cannot be negative.');
  }
  if (!Number.isInteger(inputs.totalTermMonths) || inputs.totalTermMonths <= 0) {
    issues.push('Total mortgage term must be a positive whole number of months.');
  }
  if (!Number.isInteger(inputs.fixedTermMonths) || inputs.fixedTermMonths < 0) {
    issues.push('Fixed term must be a non-negative whole number of months.');
  }
  if (
    Number.isInteger(inputs.totalTermMonths) &&
    Number.isInteger(inputs.fixedTermMonths) &&
    inputs.fixedTermMonths > inputs.totalTermMonths
  ) {
    issues.push('Fixed term cannot be longer than the total mortgage term.');
  }
  if (inputs.fixedMonthlyOverpayment !== undefined && inputs.fixedMonthlyOverpayment < 0) {
    issues.push('Fixed monthly overpayment cannot be negative.');
  }
  if (inputs.monthlySavings !== undefined && inputs.monthlySavings < 0) {
    issues.push('Monthly savings cannot be negative.');
  }
  if (inputs.currentRent !== undefined && inputs.currentRent < 0) {
    issues.push('Current rent cannot be negative.');
  }
  if (inputs.serviceCharge !== undefined && inputs.serviceCharge < 0) {
    issues.push('Service charge cannot be negative.');
  }
  if (
    inputs.targetAllowanceUtilizationPct !== undefined &&
    (inputs.targetAllowanceUtilizationPct < 0 || inputs.targetAllowanceUtilizationPct > 100)
  ) {
    issues.push('Target allowance utilization must be between 0 and 100%.');
  }
  if (
    inputs.remortgageGapMonths !== undefined &&
    (!Number.isInteger(inputs.remortgageGapMonths) || inputs.remortgageGapMonths < 0)
  ) {
    issues.push('Remortgage gap must be a non-negative whole number of months.');
  }
  if (inputs.savingsPayoutIntervalYears !== undefined && inputs.savingsPayoutIntervalYears <= 0) {
    issues.push('Savings payout interval must be greater than 0 years.');
  }
  for (const [i, lump] of (inputs.lumpSums ?? []).entries()) {
    if (!(lump.amount > 0)) {
      issues.push(`Lump sum #${i + 1}: amount must be greater than 0.`);
    }
    if (!Number.isInteger(lump.atMonth) || lump.atMonth < 1) {
      issues.push(`Lump sum #${i + 1}: month must be a whole number ≥ 1.`);
    }
  }

  return issues;
}
