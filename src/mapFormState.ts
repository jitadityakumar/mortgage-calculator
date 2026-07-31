import type { MortgageInputs } from './api/types';
import {
  DEFAULT_CONFIG,
  DEFAULT_REMORTGAGE_GAP_MONTHS,
  DEFAULT_SAVINGS_PAYOUT_INTERVAL_YEARS,
} from './api/defaults';
import { parseNum } from './format';
import type { FormState, LumpSumFormRow } from './types/formState';

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

/** Inverse of mapFormStateToInputs — populates a FormState from a saved
 * MortgageInputs (loaded from a saved calculation). `currentForm` supplies
 * values with no MortgageInputs equivalent (isFirstTimeBuyer, showAdvanced —
 * pure UI state, never persisted) and lump-sum row ids (regenerated fresh
 * rather than persisted, since they're a React key, not data). */
export function mapInputsToFormState(inputs: MortgageInputs, currentForm: FormState): FormState {
  // Strip null/undefined before merging over DEFAULT_CONFIG: a saved
  // calculation's `config` came back from the API as a full object with
  // explicit `null`s for any field that was never set (Pydantic doesn't
  // omit them), and object spread only skips *absent* keys, not null ones —
  // merging it in directly would silently overwrite real defaults with null.
  const definedOverrides = Object.fromEntries(
    Object.entries(inputs.config ?? {}).filter(([, v]) => v !== null && v !== undefined),
  );
  const config = { ...DEFAULT_CONFIG, ...definedOverrides };
  const lumpSums: LumpSumFormRow[] = (inputs.lumpSums ?? []).map((l) => ({
    id: crypto.randomUUID(),
    month: String(l.atMonth),
    amount: String(l.amount),
  }));

  return {
    ...currentForm,
    propertyValue: String(inputs.propertyValue),
    deposit: String(inputs.deposit),
    fixedRatePct: String(inputs.fixedRateAnnualPct),
    fixedTermYears: String(inputs.fixedTermMonths / 12),
    variableRatePct: String(inputs.variableRateAnnualPct),
    totalTermYears: String(inputs.totalTermMonths / 12),

    overpaymentMode: inputs.overpaymentMode ?? currentForm.overpaymentMode,
    // 0 is the correct fallback here: these three are additive inputs to the
    // rent+savings pool, and "not set" and "set to 0" are the same no-op
    // contribution — unlike savingsPayoutIntervalYears/remortgageGapMonths
    // below, where 0 is either invalid or a different real value.
    currentRent: String(inputs.currentRent ?? 0),
    monthlySavings: String(inputs.monthlySavings ?? 0),
    serviceCharge: String(inputs.serviceCharge ?? 0),

    monthlyOverpaymentAmountMode: inputs.monthlyOverpaymentAmountMode ?? currentForm.monthlyOverpaymentAmountMode,
    fixedMonthlyOverpayment: String(inputs.fixedMonthlyOverpayment ?? 0),
    // Falls back to the current form's value (the app's own opinionated
    // default, e.g. 50%) rather than a literal — the backend's raw default
    // (100%) lives only in mortgage.py, not exported as a shared constant,
    // and re-deriving it here would be another copy to keep in sync.
    targetAllowanceUtilizationPct: String(inputs.targetAllowanceUtilizationPct ?? parseNum(currentForm.targetAllowanceUtilizationPct)),

    bankedSavingsDestination: inputs.bankedSavingsDestination ?? currentForm.bankedSavingsDestination,
    // 0 would be an invalid value here (validate_inputs rejects <= 0), not a
    // no-op, so fall back to the engine's real default instead.
    savingsPayoutIntervalYears: String(inputs.savingsPayoutIntervalYears ?? DEFAULT_SAVINGS_PAYOUT_INTERVAL_YEARS),
    rateAfterFixedTermMode: inputs.rateAfterFixedTermMode ?? currentForm.rateAfterFixedTermMode,
    remortgageGapMonths: String(inputs.remortgageGapMonths ?? DEFAULT_REMORTGAGE_GAP_MONTHS),

    lumpSums,

    annualOverpaymentAllowancePct: String(config.annualOverpaymentAllowancePct),
    allowanceBasis: config.allowanceBasis,
    ercRateOnExcessPct: String(config.ercRateOnExcessPct),
    ercAppliesDuringFixedTermOnly: config.ercAppliesDuringFixedTermOnly,
    arrangementFee: String(config.arrangementFee),
    arrangementFeeAddedToLoan: config.arrangementFeeAddedToLoan,
  };
}
