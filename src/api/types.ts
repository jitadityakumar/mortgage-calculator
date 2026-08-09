/**
 * Mirrors backend/app/engine/types.py field-for-field — the wire format for
 * /api/v1/calculate and /api/v1/compare. Kept in sync by hand for now (see
 * migration.md "Open follow-ups" for the idea of generating this from the
 * backend's OpenAPI schema later). This file has no calculation logic — the
 * backend is the single source of truth for that.
 */

export type OverpaymentMode = 'reduceTerm' | 'reducePayment';
export type AllowanceBasis = 'outstanding' | 'original';
export type MonthlyOverpaymentAmountMode = 'none' | 'fixed' | 'auto';
export type BankedSavingsDestination = 'lumpSumEachCycle' | 'keepAsSavings';
export type RateAfterFixedTermMode = 'remortgageToNewFixed' | 'stayOnVariable';

export interface LumpSumOverpayment {
  atMonth: number;
  amount: number;
}

export interface MortgageConfig {
  annualOverpaymentAllowancePct: number;
  allowanceBasis: AllowanceBasis;
  ercRateOnExcessPct: number;
  ercAppliesDuringFixedTermOnly: boolean;
  arrangementFee: number;
  arrangementFeeAddedToLoan: boolean;
}

export interface MortgageInputs {
  propertyValue: number;
  deposit: number;
  fixedRateAnnualPct: number;
  fixedTermMonths: number;
  variableRateAnnualPct: number;
  totalTermMonths: number;

  lumpSums?: LumpSumOverpayment[];
  overpaymentMode?: OverpaymentMode;

  currentRent?: number;
  monthlySavings?: number;
  serviceCharge?: number;

  monthlyOverpaymentAmountMode?: MonthlyOverpaymentAmountMode;
  fixedMonthlyOverpayment?: number;
  targetAllowanceUtilizationPct?: number;

  bankedSavingsDestination?: BankedSavingsDestination;
  savingsPayoutIntervalMonths?: number;
  rateAfterFixedTermMode?: RateAfterFixedTermMode;
  remortgageGapMonths?: number;

  config?: Partial<MortgageConfig>;
}

export interface MonthlyScheduleEntry {
  month: number;
  ratePct: number;
  openingBalance: number;
  scheduledPayment: number;
  interestPaid: number;
  principalPaid: number;
  overpaymentPaid: number;
  lumpSumPaid: number;
  savingsAddedThisMonth: number;
  savingsPotBalance: number;
  isFixedPeriodBoundary: boolean;
  ercCharged: number;
  closingBalance: number;
}

export interface MortgageResult {
  schedule: MonthlyScheduleEntry[];
  principal: number;
  initialMonthlyPayment: number;
  variablePeriodMonthlyPayment: number;
  payoffMonth: number;
  totalInterestPaid: number;
  totalPrincipalPaid: number;
  totalOverpaid: number;
  totalErcPaid: number;
  totalRepaid: number;
  monthsSavedVsOriginalTerm: number;
  unallocatedSavingsPot: number;
  warnings: string[];
}

export interface ComparisonResult {
  withOverpayments: MortgageResult;
  withoutOverpayments: MortgageResult;
  interestSaved: number;
  monthsSaved: number;
}

export interface SavedCalculationSummary {
  id: number;
  name: string;
  createdAt: string;
  propertyValue: number;
  deposit: number;
  totalTermMonths: number;
}

export interface SavedCalculationDetail {
  id: number;
  name: string;
  createdAt: string;
  inputs: MortgageInputs;
}

/**
 * The single source of truth for default values, served by GET
 * /api/v1/defaults — backed by a DB row (defaults_config), admin-editable
 * via PUT /api/v1/defaults (see AdminPage.tsx), seeded from/resettable to
 * backend/app/engine/defaults.json. The form's pre-fill
 * (buildDefaultFormState in types/formState.ts) is built from this response
 * instead of hardcoding a second copy.
 */
export interface MortgageDefaults {
  config: MortgageConfig;
  variableRateAnnualPct: number;
  remortgageGapMonths: number;
  savingsPayoutIntervalMonths: number;
  fixedRateAnnualPct: number;
  fixedTermMonths: number;
  totalTermMonths: number;
  deposit: number;
  /** These three feed only buildDefaultFormState's initial pre-fill, not any
   * calculation — "derive deposit from savings" is a client-side UX
   * convenience (SDLT is computed client-side), not a backend concern.
   * deriveDepositFromSavings also gates App.tsx's live deposit auto-fill
   * (updateDepositDriver): when false, `deposit` is a plain user-controlled
   * field that never recomputes as property value/savings/FTB change. */
  depositSavings: number;
  isFirstTimeBuyer: boolean;
  deriveDepositFromSavings: boolean;
  overpaymentMode: OverpaymentMode;
  currentRent: number;
  monthlySavings: number;
  serviceCharge: number;
  monthlyOverpaymentAmountMode: MonthlyOverpaymentAmountMode;
  fixedMonthlyOverpayment: number;
  targetAllowanceUtilizationPct: number;
  bankedSavingsDestination: BankedSavingsDestination;
  rateAfterFixedTermMode: RateAfterFixedTermMode;
  /** ISO timestamp of the last admin edit; null when serving the shipped
   * defaults.json values (never persisted/edited). */
  updatedAt: string | null;
}
