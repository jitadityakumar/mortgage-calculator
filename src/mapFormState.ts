import type { MortgageInputs } from './engine';
import { parseNum } from './format';
import type { FormState } from './types/formState';

export function mapFormStateToInputs(form: FormState): MortgageInputs {
  return {
    propertyValue: parseNum(form.propertyValue),
    deposit: parseNum(form.deposit),
    fixedRateAnnualPct: parseNum(form.fixedRatePct),
    fixedTermMonths: Math.round(parseNum(form.fixedTermYears) * 12),
    variableRateAnnualPct: parseNum(form.variableRatePct),
    totalTermMonths: Math.round(parseNum(form.totalTermYears) * 12),

    overpaymentMode: form.overpaymentMode,
    currentRent: parseNum(form.currentRent),
    monthlySavings: parseNum(form.monthlySavings),
    serviceCharge: parseNum(form.serviceCharge),

    monthlyOverpaymentAmountMode: form.monthlyOverpaymentAmountMode,
    fixedMonthlyOverpayment: parseNum(form.fixedMonthlyOverpayment),
    targetAllowanceUtilizationPct: parseNum(form.targetAllowanceUtilizationPct),

    bankedSavingsDestination: form.bankedSavingsDestination,
    savingsPayoutIntervalYears: parseNum(form.savingsPayoutIntervalYears),
    rateAfterFixedTermMode: form.rateAfterFixedTermMode,
    remortgageGapMonths: Math.round(parseNum(form.remortgageGapMonths)),

    lumpSums: form.lumpSums
      .filter((l) => l.month.trim() !== '' && l.amount.trim() !== '')
      .map((l) => ({ atMonth: Math.round(parseNum(l.month)), amount: parseNum(l.amount) })),

    config: {
      annualOverpaymentAllowancePct: parseNum(form.annualOverpaymentAllowancePct),
      allowanceBasis: form.allowanceBasis,
      ercRateOnExcessPct: parseNum(form.ercRateOnExcessPct),
      ercAppliesDuringFixedTermOnly: form.ercAppliesDuringFixedTermOnly,
      arrangementFee: parseNum(form.arrangementFee),
      arrangementFeeAddedToLoan: form.arrangementFeeAddedToLoan,
    },
  };
}
