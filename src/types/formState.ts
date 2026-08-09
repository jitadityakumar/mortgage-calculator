import type {
  AllowanceBasis,
  BankedSavingsDestination,
  MonthlyOverpaymentAmountMode,
  MortgageDefaults,
  OverpaymentMode,
  RateAfterFixedTermMode,
} from '../api/types';
import { calculateSdlt } from '../engine';

export interface LumpSumFormRow {
  id: string;
  month: string;
  amount: string;
}

export interface FormState {
  propertyValue: string;
  deposit: string;
  depositSavings: string;
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
  savingsPayoutIntervalMonths: string;
  rateAfterFixedTermMode: RateAfterFixedTermMode;
  remortgageGapMonths: string;

  lumpSums: LumpSumFormRow[];

  isFirstTimeBuyer: boolean;
  /** Gates App.tsx's updateDepositDriver: when true, `deposit` auto-recomputes
   * from depositSavings minus SDLT on every property value/savings/FTB
   * change (and is precomputed that way below, on initial load); when false,
   * `deposit` is a plain user-controlled field that never auto-recomputes.
   * Seeded from defaults.deriveDepositFromSavings — not itself directly
   * editable in the live form, only via the admin defaults page. */
  deriveDepositFromSavings: boolean;

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
 * rateAfterFixedTermMode, showAdvanced) are pure UI demo/convenience values,
 * kept as literals here.
 * `depositSavings`
 * and `isFirstTimeBuyer` come from `defaults` (admin-editable, see
 * AdminPage.tsx) rather than being literals here, unlike the fields above.
 * `deposit` is computed to match: when `defaults.deriveDepositFromSavings`
 * is true, it's depositSavings minus SDLT (mirroring App.tsx's
 * `updateDepositDriver`, which keeps applying the same computation live) —
 * so the initial form already reflects the auto-fill rather than showing
 * the raw default until the user first touches property value/savings/FTB
 * status. When false, `deposit` is just `defaults.deposit` as-is.
 */
export function buildDefaultFormState(defaults: MortgageDefaults): FormState {
  const propertyValue = '450000';
  const depositSavings = String(defaults.depositSavings);
  const isFirstTimeBuyer = defaults.isFirstTimeBuyer;
  const deposit = defaults.deriveDepositFromSavings
    ? Math.max(0, Math.round(defaults.depositSavings - calculateSdlt(Number(propertyValue), isFirstTimeBuyer).totalTax))
    : defaults.deposit;

  return {
    propertyValue,
    deposit: String(deposit),
    depositSavings,
    fixedRatePct: String(defaults.fixedRateAnnualPct),
    fixedTermYears: String(defaults.fixedTermMonths / 12),
    variableRatePct: String(defaults.variableRateAnnualPct),
    totalTermYears: String(defaults.totalTermMonths / 12),

    overpaymentMode: defaults.overpaymentMode,
    currentRent: String(defaults.currentRent),
    monthlySavings: String(defaults.monthlySavings),
    serviceCharge: String(defaults.serviceCharge),

    monthlyOverpaymentAmountMode: defaults.monthlyOverpaymentAmountMode,
    fixedMonthlyOverpayment: String(defaults.fixedMonthlyOverpayment),
    targetAllowanceUtilizationPct: String(defaults.targetAllowanceUtilizationPct),

    bankedSavingsDestination: defaults.bankedSavingsDestination,
    savingsPayoutIntervalMonths: String(defaults.savingsPayoutIntervalMonths),
    rateAfterFixedTermMode: 'remortgageToNewFixed',
    remortgageGapMonths: String(defaults.remortgageGapMonths),

    lumpSums: [],

    isFirstTimeBuyer,
    deriveDepositFromSavings: defaults.deriveDepositFromSavings,

    showAdvanced: false,
    annualOverpaymentAllowancePct: String(defaults.config.annualOverpaymentAllowancePct),
    allowanceBasis: defaults.config.allowanceBasis,
    ercRateOnExcessPct: String(defaults.config.ercRateOnExcessPct),
    ercAppliesDuringFixedTermOnly: defaults.config.ercAppliesDuringFixedTermOnly,
    arrangementFee: String(defaults.config.arrangementFee),
    arrangementFeeAddedToLoan: defaults.config.arrangementFeeAddedToLoan,
  };
}
