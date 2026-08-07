import type {
  AllowanceBasis,
  BankedSavingsDestination,
  MonthlyOverpaymentAmountMode,
  MortgageDefaults,
  OverpaymentMode,
  RateAfterFixedTermMode,
} from '../api/types';

export interface LumpSumFormRow {
  id: string;
  month: string;
  amount: string;
}

export interface FormState {
  propertyValue: string;
  deposit: string;
  fixedRatePct: string;
  fixedTermYears: string;
  variableRatePct: string;
  totalTermYears: string;

  overpaymentMode: OverpaymentMode;
  currentRent: string;
  monthlySavings: string;
  serviceCharge: string;

  monthlyOverpaymentAmountMode: MonthlyOverpaymentAmountMode;
  fixedMonthlyOverpayment: string;
  targetAllowanceUtilizationPct: string;

  bankedSavingsDestination: BankedSavingsDestination;
  savingsPayoutIntervalYears: string;
  rateAfterFixedTermMode: RateAfterFixedTermMode;
  remortgageGapMonths: string;

  lumpSums: LumpSumFormRow[];

  isFirstTimeBuyer: boolean;

  showAdvanced: boolean;
  annualOverpaymentAllowancePct: string;
  allowanceBasis: AllowanceBasis;
  ercRateOnExcessPct: string;
  ercAppliesDuringFixedTermOnly: boolean;
  arrangementFee: string;
  arrangementFeeAddedToLoan: boolean;
}

/**
 * Builds the form's initial pre-fill state from the backend's GET
 * /api/v1/defaults response — the single source of truth for every
 * calculation-fallback default (see backend/app/engine/defaults.json).
 * Fields below with no calculation-default equivalent (propertyValue,
 * currentRent, monthlySavings, serviceCharge, fixedMonthlyOverpayment,
 * targetAllowanceUtilizationPct, rateAfterFixedTermMode, isFirstTimeBuyer,
 * showAdvanced) are pure UI demo/convenience values, kept as literals here.
 */
export function buildDefaultFormState(defaults: MortgageDefaults): FormState {
  return {
    propertyValue: '450000',
    deposit: String(defaults.deposit),
    fixedRatePct: String(defaults.fixedRateAnnualPct),
    fixedTermYears: String(defaults.fixedTermMonths / 12),
    variableRatePct: String(defaults.variableRateAnnualPct),
    totalTermYears: String(defaults.totalTermMonths / 12),

    overpaymentMode: defaults.overpaymentMode,
    currentRent: '2300',
    monthlySavings: '2000',
    serviceCharge: '500',

    monthlyOverpaymentAmountMode: defaults.monthlyOverpaymentAmountMode,
    fixedMonthlyOverpayment: '300',
    targetAllowanceUtilizationPct: '50',

    bankedSavingsDestination: defaults.bankedSavingsDestination,
    savingsPayoutIntervalYears: String(defaults.savingsPayoutIntervalYears),
    rateAfterFixedTermMode: 'remortgageToNewFixed',
    remortgageGapMonths: String(defaults.remortgageGapMonths),

    lumpSums: [],

    isFirstTimeBuyer: false,

    showAdvanced: false,
    annualOverpaymentAllowancePct: String(defaults.config.annualOverpaymentAllowancePct),
    allowanceBasis: defaults.config.allowanceBasis,
    ercRateOnExcessPct: String(defaults.config.ercRateOnExcessPct),
    ercAppliesDuringFixedTermOnly: defaults.config.ercAppliesDuringFixedTermOnly,
    arrangementFee: String(defaults.config.arrangementFee),
    arrangementFeeAddedToLoan: defaults.config.arrangementFeeAddedToLoan,
  };
}
