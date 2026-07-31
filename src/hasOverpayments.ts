import type { MortgageInputs } from './api/types';

/**
 * Whether `inputs` would trigger the with/without-overpayments comparison
 * view. Shared between App.tsx (to gate rendering) and src/test/mockApi.ts
 * (to decide whether the mocked schedule should differ) so the two can't
 * silently diverge on what counts as "has overpayments".
 */
export function computeHasOverpayments(inputs: MortgageInputs): boolean {
  const overpaymentModeActive = (inputs.monthlyOverpaymentAmountMode ?? 'none') !== 'none';
  const lumpSumCycleActive =
    (inputs.bankedSavingsDestination ?? 'keepAsSavings') === 'lumpSumEachCycle' &&
    inputs.fixedTermMonths < inputs.totalTermMonths &&
    (inputs.currentRent ?? 0) + (inputs.monthlySavings ?? 0) > 0;
  return overpaymentModeActive || lumpSumCycleActive || (inputs.lumpSums ?? []).length > 0;
}
