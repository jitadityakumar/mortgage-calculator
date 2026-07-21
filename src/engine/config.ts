import type { MortgageConfig } from './types';

/**
 * Illustrative defaults for England-market mortgage mechanics that vary by
 * lender and aren't provided as core inputs. See context.md "England-Specific
 * Considerations" for sourcing. Users should verify against their actual
 * mortgage offer — these are estimates, not lender-specific terms.
 */
export const DEFAULT_CONFIG: MortgageConfig = {
  annualOverpaymentAllowancePct: 10,
  allowanceBasis: 'outstanding',
  ercRateOnExcessPct: 3,
  ercAppliesDuringFixedTermOnly: true,
  arrangementFee: 0,
  arrangementFeeAddedToLoan: false,
};

/** Roughly current (2026) average lender SVR — a reasonable placeholder for the variable rate input. */
export const DEFAULT_VARIABLE_RATE_PLACEHOLDER_PCT = 7.25;

/**
 * Default assumed time on the follow-on/variable rate between one fixed deal ending
 * and the next one starting, when modeling repeated remortgaging. A same-lender
 * product transfer can be as little as a few working days, but that's for a
 * same-balance switch arranged in advance; here the balance changes first (the
 * penalty-free lump sum is paid during the gap), so a full remortgage-shaped
 * timeline is more realistic — UK full remortgages typically complete in 4-8 weeks.
 * 2 months is a reasonable round-number default; the ~1-5 working day product-transfer
 * case is effectively "no gap" and can be modeled by setting this to 0.
 */
export const DEFAULT_REMORTGAGE_GAP_MONTHS = 2;

/**
 * Default interval, in years, between periodic lump-sum payouts of banked savings
 * once the initial fixed-rate deal ends (bankedSavingsDestination:
 * 'lumpSumEachCycle', and only while rateAfterFixedTermMode is 'stayOnVariable' —
 * while cycling into new fixed deals, payout timing follows the remortgage cycle
 * instead and this value is ignored). 1 year is a reasonable round-number default;
 * fractional values (0.25, 0.5) let a user express 3 or 6 months instead.
 */
export const DEFAULT_SAVINGS_PAYOUT_INTERVAL_YEARS = 1;

export function resolveConfig(overrides?: Partial<MortgageConfig>): MortgageConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}
