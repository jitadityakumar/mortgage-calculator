export * from './types';
export {
  DEFAULT_CONFIG,
  DEFAULT_REMORTGAGE_GAP_MONTHS,
  DEFAULT_SAVINGS_PAYOUT_INTERVAL_YEARS,
  DEFAULT_VARIABLE_RATE_PLACEHOLDER_PCT,
  resolveConfig,
} from './config';
export { calculateMortgage, compareWithAndWithoutOverpayments } from './mortgage';
export { validateInputs } from './validate';
export { calculateSdlt } from './sdlt';
export type { SdltResult, SdltBandBreakdown } from './sdlt';
