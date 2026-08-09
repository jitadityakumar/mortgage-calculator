import type { MortgageDefaults, MortgageInputs } from './api/types';
import { parseNum } from './format';
import type { FormState, LumpSumFormRow } from './types/formState';

export function mapFormStateToInputs(form: FormState): MortgageInputs {
  return {
    includeSchedule: true,
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
    savingsPayoutIntervalMonths: Math.round(parseNum(form.savingsPayoutIntervalMonths)),
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
 * values with no MortgageInputs equivalent (isFirstTimeBuyer, depositSavings,
 * showAdvanced — pure UI state, never persisted) and lump-sum row ids
 * (regenerated fresh rather than persisted, since they're a React key, not
 * data). Note: `deposit` here is set from the saved `inputs.deposit` as
 * usual; App.tsx's deposit auto-fill effect is suppressed for the load that
 * follows so it doesn't overwrite it. */
export function mapInputsToFormState(
  inputs: MortgageInputs,
  currentForm: FormState,
  defaults: MortgageDefaults,
): FormState {
  // Strip null/undefined before merging over defaults.config: a saved
  // calculation's `config` came back from the API as a full object with
  // explicit `null`s for any field that was never set (Pydantic doesn't
  // omit them), and object spread only skips *absent* keys, not null ones —
  // merging it in directly would silently overwrite real defaults with null.
  const definedOverrides = Object.fromEntries(
    Object.entries(inputs.config ?? {}).filter(([, v]) => v !== null && v !== undefined),
  );
  const config = { ...defaults.config, ...definedOverrides };
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
    // Fall back to the admin-editable shared default (like
    // fixedMonthlyOverpayment/savingsPayoutIntervalMonths below) now that
    // these are real fields on MortgageDefaults instead of pure FE literals.
    currentRent: String(inputs.currentRent ?? defaults.currentRent),
    monthlySavings: String(inputs.monthlySavings ?? defaults.monthlySavings),
    serviceCharge: String(inputs.serviceCharge ?? defaults.serviceCharge),

    monthlyOverpaymentAmountMode: inputs.monthlyOverpaymentAmountMode ?? currentForm.monthlyOverpaymentAmountMode,
    // Both fall back to the admin-editable shared default (like
    // savingsPayoutIntervalMonths/remortgageGapMonths below) rather than a
    // literal or the current form's value, now that these are real fields on
    // MortgageDefaults instead of pure FE literals.
    fixedMonthlyOverpayment: String(inputs.fixedMonthlyOverpayment ?? defaults.fixedMonthlyOverpayment),
    targetAllowanceUtilizationPct: String(inputs.targetAllowanceUtilizationPct ?? defaults.targetAllowanceUtilizationPct),

    bankedSavingsDestination: inputs.bankedSavingsDestination ?? currentForm.bankedSavingsDestination,
    // 0 would be an invalid value here (validate_inputs rejects <= 0), not a
    // no-op, so fall back to the engine's real default instead.
    savingsPayoutIntervalMonths: String(inputs.savingsPayoutIntervalMonths ?? defaults.savingsPayoutIntervalMonths),
    // Falls back to currentForm, like the other mode/enum fields above, not
    // defaults.rateAfterFixedTermMode.
    rateAfterFixedTermMode: inputs.rateAfterFixedTermMode ?? currentForm.rateAfterFixedTermMode,
    remortgageGapMonths: String(inputs.remortgageGapMonths ?? defaults.remortgageGapMonths),

    lumpSums,

    annualOverpaymentAllowancePct: String(config.annualOverpaymentAllowancePct),
    allowanceBasis: config.allowanceBasis,
    ercRateOnExcessPct: String(config.ercRateOnExcessPct),
    ercAppliesDuringFixedTermOnly: config.ercAppliesDuringFixedTermOnly,
    arrangementFee: String(config.arrangementFee),
    arrangementFeeAddedToLoan: config.arrangementFeeAddedToLoan,
  };
}
