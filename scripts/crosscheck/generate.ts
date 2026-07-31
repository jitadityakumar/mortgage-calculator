// One-off cross-check generator: produces randomized-but-valid MortgageInputs
// and the TS engine's outputs for them, for comparison against the ported
// Python engine (see backend/scripts/crosscheck_compare.py).
import { writeFileSync } from 'node:fs';
import { calculateMortgage, compareWithAndWithoutOverpayments } from '../../src/engine/mortgage.ts';
import type { MortgageInputs } from '../../src/engine/types.ts';

// Minimal seeded PRNG (mulberry32) for reproducibility.
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260731);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number, decimals = 2): number {
  const v = rand() * (max - min) + min;
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

// undefined with some probability, so the TS `??` / Python `is not None`
// default-fallback branches actually get exercised (a generator that always
// supplies a value never proves the defaulting logic agrees).
function maybe<T>(value: T, undefinedChance = 0.3): T | undefined {
  return rand() < undefinedChance ? undefined : value;
}

function generateInputs(): MortgageInputs {
  const totalTermMonths = pick([120, 180, 240, 300, 360]);
  const fixedTermMonths = pick([0, 24, 60, 120, totalTermMonths]);
  const propertyValue = randInt(120_000, 800_000);
  const deposit = Math.round(propertyValue * randFloat(0.05, 0.4));

  const overpaymentAmountMode = pick(['none', 'fixed', 'auto'] as const);
  const bankedSavingsDestination = pick(['lumpSumEachCycle', 'keepAsSavings'] as const);
  const rateAfterFixedTermMode = pick(['remortgageToNewFixed', 'stayOnVariable'] as const);
  const overpaymentMode = pick(['reduceTerm', 'reducePayment'] as const);

  // 0, 1, or 2 lump sums, sometimes sharing the same month (exercises the
  // dict/Map aggregation path), sometimes scheduled past payoff (exercises
  // the "ignored" warning path).
  const lumpSumCount = pick([0, 1, 1, 2, 2]);
  const lumpSums = Array.from({ length: lumpSumCount }, () => ({
    atMonth: randInt(1, totalTermMonths + 20),
    amount: randInt(500, 20_000),
  }));
  if (lumpSumCount === 2 && rand() > 0.5) {
    // Force a duplicate-month case some of the time.
    lumpSums[1].atMonth = lumpSums[0].atMonth;
  }

  return {
    propertyValue,
    deposit,
    // Occasionally exactly 0%, to exercise the 0-rate branch of the annuity
    // formula (near-zero probability under a plain continuous randFloat).
    fixedRateAnnualPct: pick([0, 0, randFloat(0, 8)]),
    fixedTermMonths,
    variableRateAnnualPct: pick([0, 0, randFloat(0, 10)]),
    totalTermMonths,
    lumpSums,
    overpaymentMode,
    currentRent: maybe(randInt(0, 2500)),
    monthlySavings: maybe(randInt(0, 1500)),
    serviceCharge: maybe(randInt(0, 300)),
    monthlyOverpaymentAmountMode: overpaymentAmountMode,
    fixedMonthlyOverpayment: overpaymentAmountMode === 'fixed' ? randInt(0, 1500) : undefined,
    targetAllowanceUtilizationPct: maybe(randInt(0, 100)),
    bankedSavingsDestination,
    savingsPayoutIntervalYears: maybe(pick([0.25, 0.5, 1, 2])),
    rateAfterFixedTermMode,
    remortgageGapMonths: maybe(pick([0, 1, 2, 6])),
    // Sometimes a full override object, sometimes a *partial* one (exercises
    // the merge-over-defaults path for individual keys), sometimes omitted.
    config:
      rand() > 0.66
        ? {
            annualOverpaymentAllowancePct: randFloat(5, 20),
            allowanceBasis: pick(['outstanding', 'original'] as const),
            ercRateOnExcessPct: randFloat(0, 5),
            ercAppliesDuringFixedTermOnly: pick([true, false]),
            arrangementFee: randInt(0, 2000),
            arrangementFeeAddedToLoan: pick([true, false]),
          }
        : rand() > 0.5
          ? { ercRateOnExcessPct: randFloat(0, 5) }
          : undefined,
  };
}

const N = 500;
const cases: { inputs: MortgageInputs; calculate: unknown; compare: unknown }[] = [];

let attempts = 0;
while (cases.length < N && attempts < N * 5) {
  attempts++;
  const inputs = generateInputs();
  try {
    const calculate = calculateMortgage(inputs);
    const compare = compareWithAndWithoutOverpayments(inputs);
    cases.push({ inputs, calculate, compare });
  } catch {
    // Invalid combination (e.g. deposit >= propertyValue) - skip, try another.
  }
}

writeFileSync(new URL('./ts_output.json', import.meta.url), JSON.stringify(cases, null, 2));
console.log(`Generated ${cases.length} cross-check cases -> scripts/crosscheck/ts_output.json`);
