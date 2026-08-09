import { describe, expect, it } from 'vitest';
import type { MortgageDefaults, MortgageInputs } from './api/types';
import { mapFormStateToInputs, mapInputsToFormState } from './mapFormState';
import { buildDefaultFormState } from './types/formState';

const TEST_DEFAULTS: MortgageDefaults = {
  config: {
    annualOverpaymentAllowancePct: 10,
    allowanceBasis: 'outstanding',
    ercRateOnExcessPct: 3,
    ercAppliesDuringFixedTermOnly: true,
    arrangementFee: 0,
    arrangementFeeAddedToLoan: false,
  },
  variableRateAnnualPct: 7.25,
  remortgageGapMonths: 2,
  savingsPayoutIntervalMonths: 6,
  fixedRateAnnualPct: 4.5,
  fixedTermMonths: 60,
  totalTermMonths: 300,
  deposit: 80_000,
  depositSavings: 90_000,
  isFirstTimeBuyer: true,
  deriveDepositFromSavings: true,
  overpaymentMode: 'reduceTerm',
  monthlyOverpaymentAmountMode: 'auto',
  fixedMonthlyOverpayment: 300,
  targetAllowanceUtilizationPct: 50,
  bankedSavingsDestination: 'lumpSumEachCycle',
  updatedAt: null,
};

const DEFAULT_FORM_STATE = buildDefaultFormState(TEST_DEFAULTS);

const FULL_INPUTS: MortgageInputs = {
  propertyValue: 450_000,
  deposit: 80_000,
  fixedRateAnnualPct: 4.5,
  fixedTermMonths: 60,
  variableRateAnnualPct: 7.25,
  totalTermMonths: 300,
  overpaymentMode: 'reducePayment',
  currentRent: 2300,
  monthlySavings: 2000,
  serviceCharge: 500,
  monthlyOverpaymentAmountMode: 'fixed',
  fixedMonthlyOverpayment: 300,
  targetAllowanceUtilizationPct: 75,
  bankedSavingsDestination: 'keepAsSavings',
  savingsPayoutIntervalMonths: 24,
  rateAfterFixedTermMode: 'stayOnVariable',
  remortgageGapMonths: 3,
  lumpSums: [{ atMonth: 12, amount: 5000 }],
  config: {
    annualOverpaymentAllowancePct: 8,
    allowanceBasis: 'original',
    ercRateOnExcessPct: 2,
    ercAppliesDuringFixedTermOnly: false,
    arrangementFee: 999,
    arrangementFeeAddedToLoan: true,
  },
};

describe('mapInputsToFormState / mapFormStateToInputs round trip', () => {
  it('round-trips a fully-populated MortgageInputs exactly', () => {
    const form = mapInputsToFormState(FULL_INPUTS, DEFAULT_FORM_STATE, TEST_DEFAULTS);
    const roundTripped = mapFormStateToInputs(form);
    expect(roundTripped).toEqual(FULL_INPUTS);
  });

  it('falls back to engine defaults, not 0, for fields that are invalid at 0', () => {
    const minimal: MortgageInputs = {
      propertyValue: 450_000,
      deposit: 80_000,
      fixedRateAnnualPct: 4.5,
      fixedTermMonths: 60,
      variableRateAnnualPct: 7.25,
      totalTermMonths: 300,
    };
    const form = mapInputsToFormState(minimal, DEFAULT_FORM_STATE, TEST_DEFAULTS);

    // 0 would be rejected by validate_inputs (savingsPayoutIntervalMonths must
    // be > 0) — the real regression this test targets.
    expect(form.savingsPayoutIntervalMonths).toBe(String(TEST_DEFAULTS.savingsPayoutIntervalMonths));
    expect(form.remortgageGapMonths).toBe(String(TEST_DEFAULTS.remortgageGapMonths));
    expect(form.fixedMonthlyOverpayment).toBe(String(TEST_DEFAULTS.fixedMonthlyOverpayment));
    expect(form.targetAllowanceUtilizationPct).toBe(String(TEST_DEFAULTS.targetAllowanceUtilizationPct));

    // 0 IS the correct no-op fallback for these — additive pool inputs.
    expect(form.currentRent).toBe('0');
    expect(form.monthlySavings).toBe('0');
    expect(form.serviceCharge).toBe('0');
  });

  it('does not let an explicit-null config field (as the API actually returns for unset fields) clobber the shared defaults', () => {
    // Mirrors a real API response: Pydantic serializes every MortgageConfig
    // field, using null (not omission) for anything that was never set.
    const partialConfigFromApi = {
      arrangementFee: 999,
      annualOverpaymentAllowancePct: null,
      allowanceBasis: null,
      ercRateOnExcessPct: null,
      ercAppliesDuringFixedTermOnly: null,
      arrangementFeeAddedToLoan: null,
    } as unknown as MortgageInputs['config'];

    const inputs: MortgageInputs = { ...FULL_INPUTS, config: partialConfigFromApi };
    const form = mapInputsToFormState(inputs, DEFAULT_FORM_STATE, TEST_DEFAULTS);

    expect(form.arrangementFee).toBe('999');
    expect(form.annualOverpaymentAllowancePct).toBe(String(TEST_DEFAULTS.config.annualOverpaymentAllowancePct));
    expect(form.allowanceBasis).toBe(TEST_DEFAULTS.config.allowanceBasis);
    expect(form.ercRateOnExcessPct).toBe(String(TEST_DEFAULTS.config.ercRateOnExcessPct));
    expect(form.ercAppliesDuringFixedTermOnly).toBe(TEST_DEFAULTS.config.ercAppliesDuringFixedTermOnly);
    expect(form.arrangementFeeAddedToLoan).toBe(TEST_DEFAULTS.config.arrangementFeeAddedToLoan);
  });

  it('round-trips lump sums', () => {
    const form = mapInputsToFormState(FULL_INPUTS, DEFAULT_FORM_STATE, TEST_DEFAULTS);
    expect(form.lumpSums).toHaveLength(1);
    expect(form.lumpSums[0].month).toBe('12');
    expect(form.lumpSums[0].amount).toBe('5000');
  });

  it('preserves UI-only fields (isFirstTimeBuyer, depositSavings, showAdvanced) from the current form', () => {
    const currentForm = { ...DEFAULT_FORM_STATE, isFirstTimeBuyer: true, depositSavings: '123000', showAdvanced: true };
    const form = mapInputsToFormState(FULL_INPUTS, currentForm, TEST_DEFAULTS);
    expect(form.isFirstTimeBuyer).toBe(true);
    expect(form.depositSavings).toBe('123000');
    expect(form.showAdvanced).toBe(true);
  });
});
