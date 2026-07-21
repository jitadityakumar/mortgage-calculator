export type OverpaymentMode = 'reduceTerm' | 'reducePayment';
export type AllowanceBasis = 'outstanding' | 'original';

/**
 * How the recurring monthly overpayment amount is determined:
 * - 'none': no recurring monthly overpayment (a lump-sum-only strategy is still
 *   possible via bankedSavingsDestination if currentRent/monthlySavings are set).
 * - 'fixed': overpay exactly fixedMonthlyOverpayment every month, unconditionally
 *   (may incur an ERC if it exceeds the penalty-free allowance — same risk as any
 *   plain manual overpayment). Whatever's left of the rent+savings pool after this
 *   amount still banks per bankedSavingsDestination.
 * - 'auto': each month, overpay the most that fits within targetAllowanceUtilizationPct
 *   of the lender's real penalty-free allowance (after any manual lump sums that
 *   month) — this can never trigger an ERC on its own. The rest of the pool banks.
 */
export type MonthlyOverpaymentAmountMode = 'none' | 'fixed' | 'auto';

/**
 * What happens to rent+savings pool money not used for the recurring monthly
 * overpayment:
 * - 'lumpSumEachCycle': bank it, and pay it out as a lump sum. *When* it pays out
 *   depends on rateAfterFixedTermMode:
 *   - 'remortgageToNewFixed': the month immediately after each fixed deal ends —
 *     the one point per cycle that's genuinely free of the fixed tie-in — then
 *     repeating every cycle. savingsPayoutIntervalYears is ignored in this case.
 *   - 'stayOnVariable' (or no further cycling is possible): the month the initial
 *     fixed deal ends, then periodically every savingsPayoutIntervalYears after
 *     that, since there's no remortgage cycle to anchor payouts to instead.
 *   Either way, each payout is re-metered against the real penalty-free allowance
 *   (it must never itself incur an ERC), so it stays safe even where a payout
 *   happens to land inside a fixed deal (allowance-limited rather than free).
 * - 'keepAsSavings': just let it accumulate as plain savings, visible in the
 *   schedule, never applied to the mortgage.
 */
export type BankedSavingsDestination = 'lumpSumEachCycle' | 'keepAsSavings';

/**
 * What happens to the interest rate once the fixed-rate deal ends:
 * - 'remortgageToNewFixed': after remortgageGapMonths on the follow-on/variable
 *   rate, roll onto a fresh fixed-rate deal at the same fixedRateAnnualPct (no rate
 *   speculation across cycles — a disclosed simplification), and keep repeating for
 *   the life of the loan. Also determines bankedSavingsDestination's payout timing
 *   — see BankedSavingsDestination.
 * - 'stayOnVariable': move onto the follow-on/variable rate once the fixed deal
 *   ends and stay there for the rest of the term — no further fixed periods.
 */
export type RateAfterFixedTermMode = 'remortgageToNewFixed' | 'stayOnVariable';

export interface LumpSumOverpayment {
  /** 1-indexed month number the lump sum is applied at (month 1 = first payment month). */
  atMonth: number;
  /** Amount in pounds. */
  amount: number;
}

export interface MortgageConfig {
  /** Penalty-free overpayment allowance, as a % of balance, per 12-month period. */
  annualOverpaymentAllowancePct: number;
  /** What the allowance % is calculated against each year. */
  allowanceBasis: AllowanceBasis;
  /** Early Repayment Charge rate applied to the portion of overpayment exceeding the allowance. */
  ercRateOnExcessPct: number;
  /** ERC only applies while still within the fixed-rate period. */
  ercAppliesDuringFixedTermOnly: boolean;
  /** Lender arrangement/product fee, in pounds. */
  arrangementFee: number;
  /** If true, fee is added to the loan principal; if false, treated as paid upfront (outside loan math). */
  arrangementFeeAddedToLoan: boolean;
}

export interface MortgageInputs {
  /** Property purchase price, in pounds. */
  propertyValue: number;
  /** Deposit, in pounds. */
  deposit: number;
  /** Fixed-period annual interest rate, as a percentage (e.g. 4.5 for 4.5%). */
  fixedRateAnnualPct: number;
  /** Length of the fixed-rate period, in months. */
  fixedTermMonths: number;
  /** Variable/follow-on annual interest rate, as a percentage, applied outside a fixed period. */
  variableRateAnnualPct: number;
  /** Full mortgage amortization length, in months. */
  totalTermMonths: number;

  /** One-off extra payments at specific months, in addition to any recurring/periodic-payout overpayments. */
  lumpSums?: LumpSumOverpayment[];
  /** How overpayments are applied to the loan. Defaults to 'reduceTerm'. */
  overpaymentMode?: OverpaymentMode;

  /** What you currently pay in rent, in pounds/month — freed up once the mortgage replaces it. */
  currentRent?: number;
  /** What you already save each month today, in pounds, independent of rent. */
  monthlySavings?: number;
  /** Recurring monthly service charge/ground rent, in pounds — deducted from the rent+savings pool before overpayments. */
  serviceCharge?: number;

  /** How the recurring monthly overpayment amount is determined. Defaults to 'none'. */
  monthlyOverpaymentAmountMode?: MonthlyOverpaymentAmountMode;
  /** 'fixed' mode only: the exact £ amount to overpay every month. Ignored otherwise. */
  fixedMonthlyOverpayment?: number;
  /**
   * 'auto' mode only: cap the auto-calculated overpayment to this % of the lender's
   * real penalty-free allowance (0-100, default 100 = use the full allowance). Lets
   * a user deliberately bank more for liquidity even when the lender would allow
   * more penalty-free overpayment.
   */
  targetAllowanceUtilizationPct?: number;

  /**
   * What happens to pool money not used for the recurring overpayment. Defaults to
   * 'keepAsSavings' at the engine level (periodic payouts only activate when a
   * caller actively opts in) — the app's own form state defaults to
   * 'lumpSumEachCycle'.
   */
  bankedSavingsDestination?: BankedSavingsDestination;
  /**
   * 'lumpSumEachCycle' + 'stayOnVariable' only (ignored while cycling into new
   * fixed deals — see BankedSavingsDestination): how often, in years, banked
   * savings pay out as a lump sum after the first payout (which lands the month
   * the initial fixed-rate deal ends). Fractional values are supported — 0.25 for
   * 3 months, 0.5 for 6 months. Defaults to DEFAULT_SAVINGS_PAYOUT_INTERVAL_YEARS
   * (1 — once a year).
   */
  savingsPayoutIntervalYears?: number;
  /**
   * What happens to the interest rate once the fixed deal ends. Defaults to
   * 'stayOnVariable' at the engine level (rate-cycling only activates when a caller
   * actively opts in) — the app's own form state defaults to 'remortgageToNewFixed'.
   */
  rateAfterFixedTermMode?: RateAfterFixedTermMode;
  /**
   * 'remortgageToNewFixed' only: months spent on the follow-on/variable rate between
   * one fixed-rate deal ending and the next one starting. Defaults to
   * DEFAULT_REMORTGAGE_GAP_MONTHS.
   */
  remortgageGapMonths?: number;

  /** Overrides merged over DEFAULT_CONFIG. */
  config?: Partial<MortgageConfig>;
}

export interface MonthlyScheduleEntry {
  month: number;
  ratePct: number;
  openingBalance: number;
  scheduledPayment: number;
  interestPaid: number;
  principalPaid: number;
  /** Total extra paid this month beyond the scheduled payment (recurring + lump sum, combined). */
  overpaymentPaid: number;
  /** The portion of overpaymentPaid that was a lump sum — user-entered or a periodic savings payout — not the recurring monthly amount. */
  lumpSumPaid: number;
  /** Pool money banked this month rather than put toward the recurring overpayment (i.e. this month's saving, not a running total). */
  savingsAddedThisMonth: number;
  /** Running balance of banked savings not yet applied to the mortgage, after this month's activity. */
  savingsPotBalance: number;
  /** True if this is the last month of a fixed-rate portion (about to move to the follow-on/variable rate). */
  isFixedPeriodBoundary: boolean;
  ercCharged: number;
  closingBalance: number;
}

export interface MortgageResult {
  schedule: MonthlyScheduleEntry[];
  /** Loan principal at month 1 (property value − deposit, plus fee if added to loan). */
  principal: number;
  /** The originally-scheduled monthly payment during the fixed period, before any overpayments. */
  initialMonthlyPayment: number;
  /** The recast monthly payment the first time the loan moves off the fixed rate (before overpayments alter it further under reducePayment mode). */
  variablePeriodMonthlyPayment: number;
  /** Month the balance reached zero. */
  payoffMonth: number;
  totalInterestPaid: number;
  totalPrincipalPaid: number;
  totalOverpaid: number;
  totalErcPaid: number;
  /** Sum of all scheduled payments + overpayments + ERC actually paid over the life of the loan. */
  totalRepaid: number;
  /** Months saved vs. the original totalTermMonths (0 if not paid off early). */
  monthsSavedVsOriginalTerm: number;
  /**
   * Savings banked toward a lump-sum payout that never reached the mortgage — either
   * because bankedSavingsDestination is 'keepAsSavings', or because the loan was
   * paid off / the term ended before the next scheduled payout point. Still the
   * borrower's money — just never applied to the mortgage.
   */
  unallocatedSavingsPot: number;
  /** Non-fatal notices, e.g. a lump sum scheduled after payoff was ignored. */
  warnings: string[];
}

export interface ComparisonResult {
  withOverpayments: MortgageResult;
  withoutOverpayments: MortgageResult;
  interestSaved: number;
  monthsSaved: number;
}

export class MortgageValidationError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(`Invalid mortgage inputs: ${issues.join('; ')}`);
    this.name = 'MortgageValidationError';
    this.issues = issues;
  }
}
