import {
  DEFAULT_CONFIG,
  DEFAULT_REMORTGAGE_GAP_MONTHS,
  DEFAULT_SAVINGS_PAYOUT_INTERVAL_YEARS,
  DEFAULT_VARIABLE_RATE_PLACEHOLDER_PCT,
} from '../api/defaults';
import type {
  AllowanceBasis,
  BankedSavingsDestination,
  MonthlyOverpaymentAmountMode,
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

export const DEFAULT_FORM_STATE: FormState = {
  propertyValue: '450000',
  deposit: '80000',
  fixedRatePct: '4.5',
  fixedTermYears: '5',
  variableRatePct: String(DEFAULT_VARIABLE_RATE_PLACEHOLDER_PCT),
  totalTermYears: '25',

  overpaymentMode: 'reduceTerm',
  currentRent: '2300',
  monthlySavings: '2000',
  serviceCharge: '500',

  monthlyOverpaymentAmountMode: 'auto',
  fixedMonthlyOverpayment: '300',
  targetAllowanceUtilizationPct: '50',

  bankedSavingsDestination: 'lumpSumEachCycle',
  savingsPayoutIntervalYears: String(DEFAULT_SAVINGS_PAYOUT_INTERVAL_YEARS),
  rateAfterFixedTermMode: 'remortgageToNewFixed',
  remortgageGapMonths: String(DEFAULT_REMORTGAGE_GAP_MONTHS),

  lumpSums: [],

  isFirstTimeBuyer: false,

  showAdvanced: false,
  annualOverpaymentAllowancePct: String(DEFAULT_CONFIG.annualOverpaymentAllowancePct),
  allowanceBasis: DEFAULT_CONFIG.allowanceBasis,
  ercRateOnExcessPct: String(DEFAULT_CONFIG.ercRateOnExcessPct),
  ercAppliesDuringFixedTermOnly: DEFAULT_CONFIG.ercAppliesDuringFixedTermOnly,
  arrangementFee: String(DEFAULT_CONFIG.arrangementFee),
  arrangementFeeAddedToLoan: DEFAULT_CONFIG.arrangementFeeAddedToLoan,
};
