import type { MortgageConfig } from './types';

/**
 * Mirrors backend/app/engine/config.py's DEFAULT_CONFIG and related
 * constants — used to pre-fill the form before the user has typed anything.
 *
 * This IS a live "two sources of truth" risk, not an inert one:
 * mapFormStateToInputs() always sends a fully-populated `config` object (and
 * variableRateAnnualPct/savingsPayoutIntervalYears/remortgageGapMonths) as
 * explicit values on every request, so the backend's own defaults are never
 * actually reached once a form exists — these FE constants silently become
 * the effective values. If they drift from backend/app/engine/config.py,
 * results drift too, without either side erroring. Kept in sync by hand for
 * now; see migration.md "Open follow-ups" for fetching these from the
 * backend instead once the API has a place to serve them from.
 */
export const DEFAULT_CONFIG: MortgageConfig = {
  annualOverpaymentAllowancePct: 10,
  allowanceBasis: 'outstanding',
  ercRateOnExcessPct: 3,
  ercAppliesDuringFixedTermOnly: true,
  arrangementFee: 0,
  arrangementFeeAddedToLoan: false,
};

export const DEFAULT_VARIABLE_RATE_PLACEHOLDER_PCT = 7.25;
export const DEFAULT_REMORTGAGE_GAP_MONTHS = 2;
export const DEFAULT_SAVINGS_PAYOUT_INTERVAL_YEARS = 1;
