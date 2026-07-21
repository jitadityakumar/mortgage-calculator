import { describe, expect, it } from 'vitest';
import { calculateMortgage, compareWithAndWithoutOverpayments } from './mortgage';
import { MortgageValidationError, type MortgageInputs } from './types';

/** Independent reference implementation of the standard annuity formula, kept
 * deliberately separate from src/engine so tests don't just check the code
 * agrees with itself. */
function referenceMonthlyPayment(principal: number, annualPct: number, months: number): number {
  const r = annualPct / 100 / 12;
  if (r === 0) return principal / months;
  const factor = Math.pow(1 + r, months);
  return (principal * r * factor) / (factor - 1);
}

function baseInputs(overrides: Partial<MortgageInputs> = {}): MortgageInputs {
  return {
    propertyValue: 250_000,
    deposit: 50_000,
    fixedRateAnnualPct: 5,
    fixedTermMonths: 300,
    variableRateAnnualPct: 5,
    totalTermMonths: 300,
    ...overrides,
  };
}

/** Shorthand for a static, unconditional monthly overpayment (the old flat "monthlyOverpayment" field). */
function fixedOverpayment(amount: number): Partial<MortgageInputs> {
  return { monthlyOverpaymentAmountMode: 'fixed', fixedMonthlyOverpayment: amount };
}

describe('calculateMortgage — core amortization', () => {
  it('matches the standard annuity formula for a plain (no-overpayment) loan', () => {
    const inputs = baseInputs();
    const result = calculateMortgage(inputs);
    const expectedPayment = referenceMonthlyPayment(200_000, 5, 300);

    expect(result.principal).toBe(200_000);
    expect(result.initialMonthlyPayment).toBeCloseTo(expectedPayment, 1);
    // Known reference value for £200,000 / 5% / 25yr (300mo) ≈ £1,169.18/mo.
    expect(result.initialMonthlyPayment).toBeCloseTo(1169.18, 1);
  });

  it('fully amortizes: schedule ends at exactly zero balance with no negative dip', () => {
    const result = calculateMortgage(baseInputs());
    expect(result.schedule).toHaveLength(300);
    expect(result.schedule.at(-1)!.closingBalance).toBe(0);
    for (const entry of result.schedule) {
      expect(entry.closingBalance).toBeGreaterThanOrEqual(0);
    }
  });

  it('sum of principal paid across the schedule equals the loan amount', () => {
    const result = calculateMortgage(baseInputs());
    const totalPrincipalFromSchedule = result.schedule.reduce((sum, e) => sum + e.principalPaid, 0);
    expect(totalPrincipalFromSchedule).toBeCloseTo(result.principal, 1);
    expect(result.totalPrincipalPaid).toBeCloseTo(result.principal, 1);
  });

  it('special-cases a 0% interest rate instead of dividing by zero', () => {
    const result = calculateMortgage(
      baseInputs({ fixedRateAnnualPct: 0, variableRateAnnualPct: 0 }),
    );
    expect(result.initialMonthlyPayment).toBeCloseTo(200_000 / 300, 2);
    expect(result.totalInterestPaid).toBe(0);
    expect(result.schedule.at(-1)!.closingBalance).toBe(0);
  });
});

describe('calculateMortgage — fixed to variable rate transition (no cycling)', () => {
  it('recasts the payment at the fixed/variable boundary using the actual remaining balance', () => {
    // rateAfterFixedTermMode defaults to 'stayOnVariable' at the engine level, so
    // this is the simple single fixed -> follow-on-forever schedule.
    const inputs = baseInputs({ fixedTermMonths: 60, variableRateAnnualPct: 7.25 });
    const result = calculateMortgage(inputs);

    const lastFixedMonth = result.schedule[59];
    const firstVariableMonth = result.schedule[60];
    expect(lastFixedMonth.ratePct).toBe(5);
    expect(firstVariableMonth.ratePct).toBe(7.25);
    expect(lastFixedMonth.isFixedPeriodBoundary).toBe(true);

    const remainingBalance = lastFixedMonth.closingBalance;
    const expectedRecastPayment = referenceMonthlyPayment(remainingBalance, 7.25, 300 - 60);
    expect(result.variablePeriodMonthlyPayment).toBeCloseTo(expectedRecastPayment, 1);
    expect(firstVariableMonth.scheduledPayment).toBeCloseTo(expectedRecastPayment, 1);

    // Payment actually changes at the boundary (rates differ meaningfully here).
    expect(firstVariableMonth.scheduledPayment).not.toBeCloseTo(lastFixedMonth.scheduledPayment, 0);

    // Never re-fixes: stays on the variable rate for the rest of the term.
    expect(result.schedule.slice(60).every((e) => e.ratePct === 7.25)).toBe(true);
  });

  it('never enters a variable period if fixedTermMonths equals totalTermMonths', () => {
    const result = calculateMortgage(baseInputs({ fixedTermMonths: 300, variableRateAnnualPct: 99 }));
    expect(result.variablePeriodMonthlyPayment).toBe(0);
    expect(result.schedule.every((e) => e.ratePct === 5)).toBe(true);
  });
});

describe('calculateMortgage — overpayments (fixed amount)', () => {
  it('reduceTerm mode: keeps the scheduled payment constant and pays off early', () => {
    const inputs = baseInputs({
      fixedTermMonths: 300,
      overpaymentMode: 'reduceTerm',
      ...fixedOverpayment(300),
    });
    const result = calculateMortgage(inputs);

    expect(result.payoffMonth).toBeLessThan(300);
    expect(result.monthsSavedVsOriginalTerm).toBe(300 - result.payoffMonth);

    // Scheduled payment should stay constant through the bulk of the schedule —
    // only the tail end (as the balance runs out) and the overpayment portion
    // change, not the base scheduled payment itself.
    const safeMiddleRange = result.schedule.slice(1, Math.floor(result.payoffMonth * 0.8));
    expect(safeMiddleRange.length).toBeGreaterThan(10);
    const first = safeMiddleRange[0].scheduledPayment;
    for (const entry of safeMiddleRange) {
      expect(entry.scheduledPayment).toBeCloseTo(first, 1);
    }
  });

  it('reducePayment mode: payments decline over time instead of staying flat', () => {
    const inputs = baseInputs({
      fixedTermMonths: 300,
      overpaymentMode: 'reducePayment',
      ...fixedOverpayment(300),
    });
    const result = calculateMortgage(inputs);

    const earlyPayment = result.schedule[5].scheduledPayment;
    const latePayment = result.schedule[200].scheduledPayment;
    expect(latePayment).toBeLessThan(earlyPayment);
  });

  it('reducePayment mode never pays off earlier than reduceTerm mode for the same overpayment', () => {
    // Injecting extra cash every month always accelerates payoff to some degree —
    // no recalculation scheme can hold the term exactly fixed while that happens.
    // reduceTerm maximizes the acceleration (payment never drops); reducePayment
    // spreads the benefit into declining payments instead, so it should finish
    // at the same time or later than reduceTerm, never earlier.
    const reduceTermResult = calculateMortgage(
      baseInputs({ overpaymentMode: 'reduceTerm', ...fixedOverpayment(300) }),
    );
    const reducePaymentResult = calculateMortgage(
      baseInputs({ overpaymentMode: 'reducePayment', ...fixedOverpayment(300) }),
    );
    expect(reducePaymentResult.payoffMonth).toBeGreaterThanOrEqual(reduceTermResult.payoffMonth);
    expect(reducePaymentResult.payoffMonth).toBeLessThanOrEqual(300);
  });

  it('both overpayment modes reduce total interest vs. the no-overpayment baseline', () => {
    const withReduceTerm = compareWithAndWithoutOverpayments(
      baseInputs({ overpaymentMode: 'reduceTerm', ...fixedOverpayment(250) }),
    );
    expect(withReduceTerm.interestSaved).toBeGreaterThan(0);
    expect(withReduceTerm.monthsSaved).toBeGreaterThan(0);

    const withReducePayment = compareWithAndWithoutOverpayments(
      baseInputs({ overpaymentMode: 'reducePayment', ...fixedOverpayment(250) }),
    );
    expect(withReducePayment.interestSaved).toBeGreaterThan(0);
    expect(withReducePayment.monthsSaved).toBeGreaterThanOrEqual(0);
    expect(withReducePayment.monthsSaved).toBeLessThanOrEqual(withReduceTerm.monthsSaved);
  });

  it('no overpayment inputs => comparison shows zero savings', () => {
    const comparison = compareWithAndWithoutOverpayments(baseInputs());
    expect(comparison.interestSaved).toBe(0);
    expect(comparison.monthsSaved).toBe(0);
  });

  it('applies a lump sum at the specified month, dropping the balance beyond the scheduled principal', () => {
    const withLump = calculateMortgage(
      baseInputs({ lumpSums: [{ atMonth: 12, amount: 10_000 }] }),
    );
    const withoutLump = calculateMortgage(baseInputs());

    const dropWith = withoutLump.schedule[10].closingBalance - withLump.schedule[11].closingBalance;
    // Balance should have fallen by roughly the scheduled principal *plus* the £10k lump sum.
    expect(dropWith).toBeGreaterThan(9_000);
    expect(withLump.payoffMonth).toBeLessThan(withoutLump.payoffMonth);
    expect(withLump.schedule[11].lumpSumPaid).toBeCloseTo(10_000, 1);
  });

  it('warns (but does not fail) when a lump sum is scheduled after the mortgage is already paid off', () => {
    const result = calculateMortgage(
      baseInputs({
        lumpSums: [{ atMonth: 299, amount: 1_000 }],
        ...fixedOverpayment(5_000), // pays off very early
      }),
    );
    expect(result.payoffMonth).toBeLessThan(100);
    expect(result.warnings.some((w) => w.includes('month 299'))).toBe(true);
  });

  it('caps overpayment at the remaining balance instead of driving it negative', () => {
    const result = calculateMortgage(baseInputs(fixedOverpayment(50_000)));
    for (const entry of result.schedule) {
      expect(entry.closingBalance).toBeGreaterThanOrEqual(0);
    }
    expect(result.schedule.at(-1)!.closingBalance).toBe(0);
  });
});

describe('calculateMortgage — overpayment allowance & ERC', () => {
  it('charges an ERC on overpayments exceeding the allowance during the fixed term', () => {
    const result = calculateMortgage(
      baseInputs({
        fixedTermMonths: 24,
        config: { annualOverpaymentAllowancePct: 10, ercRateOnExcessPct: 3, ercAppliesDuringFixedTermOnly: true },
        // deliberately huge relative to a £200k loan to blow past a 10% allowance fast
        ...fixedOverpayment(2_000),
      }),
    );
    const totalErc = result.totalErcPaid;
    expect(totalErc).toBeGreaterThan(0);
  });

  it('does not charge an ERC once the loan has moved to the variable period', () => {
    const result = calculateMortgage(
      baseInputs({
        fixedTermMonths: 12,
        config: { annualOverpaymentAllowancePct: 10, ercRateOnExcessPct: 3, ercAppliesDuringFixedTermOnly: true },
        ...fixedOverpayment(2_000),
      }),
    );
    const variablePeriodEntries = result.schedule.filter((e) => e.month > 12);
    expect(variablePeriodEntries.every((e) => e.ercCharged === 0)).toBe(true);
  });

  it('never charges an ERC when overpayments stay within the allowance', () => {
    const result = calculateMortgage(
      baseInputs({
        fixedTermMonths: 300,
        config: { annualOverpaymentAllowancePct: 10, ercRateOnExcessPct: 3 },
        // small relative to a £200k loan — well within a 10% annual allowance
        ...fixedOverpayment(50),
      }),
    );
    expect(result.totalErcPaid).toBe(0);
  });
});

describe('calculateMortgage — validation', () => {
  it('rejects a deposit greater than or equal to the property value', () => {
    expect(() => calculateMortgage(baseInputs({ deposit: 250_000 }))).toThrow(MortgageValidationError);
    expect(() => calculateMortgage(baseInputs({ deposit: 300_000 }))).toThrow(MortgageValidationError);
  });

  it('rejects negative rates', () => {
    expect(() => calculateMortgage(baseInputs({ fixedRateAnnualPct: -1 }))).toThrow(MortgageValidationError);
    expect(() => calculateMortgage(baseInputs({ variableRateAnnualPct: -1 }))).toThrow(MortgageValidationError);
  });

  it('rejects a fixed term longer than the total term', () => {
    expect(() =>
      calculateMortgage(baseInputs({ fixedTermMonths: 301, totalTermMonths: 300 })),
    ).toThrow(MortgageValidationError);
  });

  it('rejects a non-positive total term', () => {
    expect(() => calculateMortgage(baseInputs({ totalTermMonths: 0 }))).toThrow(MortgageValidationError);
    expect(() => calculateMortgage(baseInputs({ totalTermMonths: -12 }))).toThrow(MortgageValidationError);
  });

  it('rejects a negative deposit', () => {
    expect(() => calculateMortgage(baseInputs({ deposit: -1 }))).toThrow(MortgageValidationError);
  });

  it('rejects a target allowance utilization outside 0-100', () => {
    expect(() => calculateMortgage(baseInputs({ targetAllowanceUtilizationPct: -1 }))).toThrow(MortgageValidationError);
    expect(() => calculateMortgage(baseInputs({ targetAllowanceUtilizationPct: 101 }))).toThrow(MortgageValidationError);
  });

  it('rejects a negative or non-integer remortgage gap', () => {
    expect(() => calculateMortgage(baseInputs({ remortgageGapMonths: -1 }))).toThrow(MortgageValidationError);
    expect(() => calculateMortgage(baseInputs({ remortgageGapMonths: 1.5 }))).toThrow(MortgageValidationError);
  });

  it('rejects a non-positive savings payout interval, but allows fractional years', () => {
    expect(() => calculateMortgage(baseInputs({ savingsPayoutIntervalYears: 0 }))).toThrow(MortgageValidationError);
    expect(() => calculateMortgage(baseInputs({ savingsPayoutIntervalYears: -1 }))).toThrow(MortgageValidationError);
    // 0.25 (3 months) and 0.5 (6 months) must be valid, not rejected as non-integer.
    expect(() => calculateMortgage(baseInputs({ savingsPayoutIntervalYears: 0.25 }))).not.toThrow();
    expect(() => calculateMortgage(baseInputs({ savingsPayoutIntervalYears: 0.5 }))).not.toThrow();
  });

  it('collects multiple issues in a single error', () => {
    try {
      calculateMortgage(baseInputs({ deposit: 300_000, fixedRateAnnualPct: -2, totalTermMonths: 0 }));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MortgageValidationError);
      const issues = (err as MortgageValidationError).issues;
      expect(issues.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('calculateMortgage — rounding robustness', () => {
  it('always lands on exactly zero balance even with an awkward rate/term combination', () => {
    const result = calculateMortgage(
      baseInputs({ fixedRateAnnualPct: 4.37, variableRateAnnualPct: 6.89, fixedTermMonths: 91, totalTermMonths: 187 }),
    );
    expect(result.schedule.at(-1)!.closingBalance).toBe(0);
  });

  it('lands on exactly zero balance when overpayments cause an early payoff', () => {
    const result = calculateMortgage(baseInputs(fixedOverpayment(733)));
    expect(result.schedule.at(-1)!.closingBalance).toBe(0);
    expect(result.payoffMonth).toBe(result.schedule.length);
  });
});

describe('calculateMortgage — savings pool (currentRent + monthlySavings)', () => {
  it("mode 'none' with destination 'keepAsSavings': the pool has zero effect on the mortgage", () => {
    const withPool = calculateMortgage(
      baseInputs({
        currentRent: 2000,
        monthlySavings: 500,
        monthlyOverpaymentAmountMode: 'none',
        bankedSavingsDestination: 'keepAsSavings',
      }),
    );
    const withoutPool = calculateMortgage(baseInputs());
    expect(withPool.payoffMonth).toBe(withoutPool.payoffMonth);
    expect(withPool.totalOverpaid).toBe(0);
  });

  it("mode 'auto' applies (currentRent + monthlySavings - scheduledPayment) as overpayment when it fits the allowance", () => {
    const result = calculateMortgage(
      baseInputs({
        fixedTermMonths: 300,
        currentRent: 1000,
        monthlySavings: 400,
        monthlyOverpaymentAmountMode: 'auto',
      }),
    );
    const month1 = result.schedule[0];
    const expectedOverpayment = Math.max(0, 1000 + 400 - month1.scheduledPayment);
    expect(month1.overpaymentPaid).toBeCloseTo(expectedOverpayment, 1);
    expect(result.payoffMonth).toBeLessThan(300);
  });

  it("mode 'auto' never applies a negative overpayment when the pool is smaller than the payment", () => {
    const result = calculateMortgage(
      baseInputs({
        fixedTermMonths: 300,
        currentRent: 100,
        monthlySavings: 0,
        monthlyOverpaymentAmountMode: 'auto',
      }),
    );
    // Initial payment is ~£1,169 (see the annuity-formula test above) — a £100 pool covers none of it.
    expect(result.schedule[0].overpaymentPaid).toBe(0);
  });

  it("mode 'fixed' applies exactly the chosen amount and banks the rest of the pool", () => {
    const result = calculateMortgage(
      baseInputs({
        fixedTermMonths: 300,
        currentRent: 1000,
        monthlySavings: 400,
        monthlyOverpaymentAmountMode: 'fixed',
        fixedMonthlyOverpayment: 300,
        bankedSavingsDestination: 'keepAsSavings',
      }),
    );
    const month1 = result.schedule[0];
    expect(month1.overpaymentPaid).toBeCloseTo(300, 1);
    const expectedBanked = Math.max(0, 1000 + 400 - month1.scheduledPayment - 300);
    expect(month1.savingsPotBalance).toBeCloseTo(expectedBanked, 1);
  });

  it("mode 'fixed' applies the amount unconditionally even with no rent/savings pool at all", () => {
    const result = calculateMortgage(baseInputs(fixedOverpayment(300)));
    expect(result.schedule[0].overpaymentPaid).toBeCloseTo(300, 1);
    expect(result.schedule[0].savingsPotBalance).toBe(0);
  });

  it("mode 'none' with destination 'lumpSumEachCycle' banks the entire pool for a lump-sum-only strategy", () => {
    const result = calculateMortgage(
      baseInputs({
        fixedTermMonths: 24,
        currentRent: 3000,
        monthlySavings: 0,
        monthlyOverpaymentAmountMode: 'none',
        bankedSavingsDestination: 'lumpSumEachCycle',
      }),
    );
    expect(result.schedule[0].overpaymentPaid).toBe(0);
    expect(result.schedule[0].savingsPotBalance).toBeGreaterThan(0);
    // A lump sum eventually lands even though there's no recurring overpayment —
    // and even though rateAfterFixedTermMode is left at its default
    // ('stayOnVariable'), since the payout schedule doesn't depend on it.
    expect(result.schedule.some((e) => e.lumpSumPaid > 0)).toBe(true);
  });

  it("a lower targetAllowanceUtilizationPct banks more and overpays less in 'auto' mode", () => {
    const full = calculateMortgage(
      baseInputs({
        fixedTermMonths: 24,
        currentRent: 5000,
        monthlySavings: 0,
        monthlyOverpaymentAmountMode: 'auto',
        targetAllowanceUtilizationPct: 100,
      }),
    );
    const half = calculateMortgage(
      baseInputs({
        fixedTermMonths: 24,
        currentRent: 5000,
        monthlySavings: 0,
        monthlyOverpaymentAmountMode: 'auto',
        targetAllowanceUtilizationPct: 50,
      }),
    );
    // A £5,000/month pool comfortably exceeds the equal-monthly-installment pace
    // implied by even the full 10% annual allowance, so the installment (not the
    // pool) binds every month — compare 12-month totals since a single month's
    // installment is a near-constant fraction of the annual target either way.
    const sumOverpaid = (r: typeof full) => r.schedule.slice(0, 12).reduce((s, e) => s + e.overpaymentPaid, 0);
    expect(sumOverpaid(half)).toBeLessThan(sumOverpaid(full));
    expect(half.schedule[11].savingsPotBalance).toBeGreaterThan(full.schedule[11].savingsPotBalance);
    // Never triggers an ERC regardless of the target.
    expect(full.totalErcPaid).toBe(0);
    expect(half.totalErcPaid).toBe(0);
  });

  it("'auto' mode paces evenly within each allowance year even once permanently past the fixed term (no ERC risk)", () => {
    // Regression: allowanceUsedThisYear (which the 'auto' pacing formula relied on
    // to know how much of the year's target was already used) is only updated
    // when allowanceApplies is true — i.e. only while ERC risk actually exists.
    // Once permanently on the variable rate with the default
    // ercAppliesDuringFixedTermOnly: true, allowanceApplies is false forever, so
    // that variable never moved again: the pacing formula kept thinking none of
    // the target had been used, and divided an undiminished target by a shrinking
    // "months remaining in year" count, ramping the monthly installment up every
    // month before clipping flat against available cash near the end of each
    // year — a visible, wrong-looking sawtooth in the schedule's Overpayment
    // column, caught by inspecting the live app's amortization table.
    const result = calculateMortgage(
      baseInputs({
        fixedTermMonths: 24,
        currentRent: 3000,
        monthlySavings: 0,
        monthlyOverpaymentAmountMode: 'auto',
        targetAllowanceUtilizationPct: 50,
      }),
    );
    const recurring = (i: number) => result.schedule[i].overpaymentPaid - result.schedule[i].lumpSumPaid;
    // Months 25-36 (index 24-35): one full allowance year, entirely in the
    // permanently-variable period. Should stay flat, not ramp.
    const firstMonthOfYear = recurring(24);
    for (let i = 25; i <= 35; i++) {
      expect(recurring(i)).toBeCloseTo(firstMonthOfYear, 1);
    }
  });

  it('effective savings grows as the payment falls under reducePayment mode', () => {
    const result = calculateMortgage(
      baseInputs({
        fixedTermMonths: 300,
        overpaymentMode: 'reducePayment',
        currentRent: 1500,
        monthlySavings: 0,
        monthlyOverpaymentAmountMode: 'auto',
      }),
    );
    const earlyOverpayment = result.schedule[5].overpaymentPaid;
    const laterOverpayment = result.schedule[100].overpaymentPaid;
    expect(laterOverpayment).toBeGreaterThan(earlyOverpayment);
  });

  it('does not divide by zero when fixedTermMonths is 0 (no fixed period at all)', () => {
    expect(() =>
      calculateMortgage(
        baseInputs({
          fixedTermMonths: 0,
          currentRent: 2000,
          monthlySavings: 0,
          monthlyOverpaymentAmountMode: 'auto',
        }),
      ),
    ).not.toThrow();
  });

  it('compareWithAndWithoutOverpayments ignores the savings pool entirely in the baseline', () => {
    const comparison = compareWithAndWithoutOverpayments(
      baseInputs({
        fixedTermMonths: 24,
        currentRent: 5000,
        monthlySavings: 0,
        monthlyOverpaymentAmountMode: 'auto',
        bankedSavingsDestination: 'lumpSumEachCycle',
      }),
    );
    expect(comparison.withoutOverpayments.totalOverpaid).toBe(0);
    expect(comparison.withoutOverpayments.payoffMonth).toBe(300);
  });
});

describe('calculateMortgage — rate cycling (rateAfterFixedTermMode)', () => {
  function cyclingInputs(overrides: Partial<MortgageInputs> = {}): MortgageInputs {
    return baseInputs({
      totalTermMonths: 300,
      fixedTermMonths: 24,
      variableRateAnnualPct: 7.25,
      rateAfterFixedTermMode: 'remortgageToNewFixed',
      remortgageGapMonths: 2,
      ...overrides,
    });
  }

  it('the rate cycles fixed -> gap-on-variable -> fixed, recasting the payment at each transition', () => {
    const result = calculateMortgage(cyclingInputs());

    // Cycle 0: months 1-24 fixed, 25-26 gap (variable), cycle 1: 27-50 fixed, 51-52 gap, ...
    expect(result.schedule.slice(0, 24).every((e) => e.ratePct === 5)).toBe(true);
    expect(result.schedule[24].ratePct).toBe(7.25); // month 25
    expect(result.schedule[25].ratePct).toBe(7.25); // month 26
    expect(result.schedule[26].ratePct).toBe(5); // month 27: back to fixed
    expect(result.schedule.slice(26, 50).every((e) => e.ratePct === 5)).toBe(true);
    expect(result.schedule[50].ratePct).toBe(7.25); // month 51

    // Payment actually changes at the first transition (rates differ meaningfully).
    expect(result.schedule[23].scheduledPayment).not.toBeCloseTo(result.schedule[24].scheduledPayment, 0);

    // isFixedPeriodBoundary marks the last month of each fixed portion, accounting
    // for the gap (month 50, not 49, since the fixed portion is months 27-50).
    expect(result.schedule[23].isFixedPeriodBoundary).toBe(true); // month 24
    expect(result.schedule[49].isFixedPeriodBoundary).toBe(true); // month 50
  });

  it("does not cycle the rate when rateAfterFixedTermMode is 'stayOnVariable'", () => {
    const result = calculateMortgage(cyclingInputs({ rateAfterFixedTermMode: 'stayOnVariable' }));
    // Simple single fixed -> follow-on-forever schedule instead.
    expect(result.schedule.slice(0, 24).every((e) => e.ratePct === 5)).toBe(true);
    expect(result.schedule.slice(24).every((e) => e.ratePct === 7.25)).toBe(true);
  });

  it('never enters a variable period with a zero-month gap (no room to leave the fixed tie-in)', () => {
    const result = calculateMortgage(cyclingInputs({ remortgageGapMonths: 0 }));
    expect(result.schedule.every((e) => e.ratePct === 5)).toBe(true);
  });
});

describe('calculateMortgage — savings payout, staying on the variable rate (periodic, savingsPayoutIntervalYears)', () => {
  function payoutInputs(overrides: Partial<MortgageInputs> = {}): MortgageInputs {
    return baseInputs({
      totalTermMonths: 300,
      fixedTermMonths: 24,
      variableRateAnnualPct: 7.25,
      currentRent: 5000,
      monthlySavings: 0,
      monthlyOverpaymentAmountMode: 'auto',
      bankedSavingsDestination: 'lumpSumEachCycle',
      rateAfterFixedTermMode: 'stayOnVariable',
      ...overrides,
    });
  }

  it("mode 'auto' never triggers an ERC on its own (stays within the penalty-free allowance)", () => {
    const result = calculateMortgage(
      payoutInputs({
        config: { annualOverpaymentAllowancePct: 10, ercRateOnExcessPct: 3, ercAppliesDuringFixedTermOnly: true },
      }),
    );
    expect(result.totalErcPaid).toBe(0);
  });

  it('never triggers an ERC even when ERC applies past the fixed term (ercAppliesDuringFixedTermOnly: false)', () => {
    // Regression: a payout used to be paid out uncapped. That's penalty-free only
    // when ERC is confined to the fixed term. With ERC applying for the whole
    // term, an uncapped payout would blow through the annual allowance and incur
    // an ERC — defeating the entire point of banking it. The payout must be
    // re-metered against the allowance every time it fires.
    const result = calculateMortgage(
      payoutInputs({
        config: { annualOverpaymentAllowancePct: 10, ercRateOnExcessPct: 3, ercAppliesDuringFixedTermOnly: false },
      }),
    );
    expect(result.totalErcPaid).toBe(0);
    // Savings that couldn't apply penalty-free stay banked and are reported, not lost.
    expect(result.unallocatedSavingsPot).toBeGreaterThan(0);
  });

  it('pays out the banked pot the month the fixed term ends, then every savingsPayoutIntervalYears after that', () => {
    // Regression: the rate-cycling refactor accidentally coupled this mechanism
    // entirely to remortgaging into a new fixed deal, so it silently stopped
    // firing at all under rateAfterFixedTermMode: 'stayOnVariable'. Periodic
    // payouts must work regardless of what the rate does afterwards.
    const result = calculateMortgage(payoutInputs({ savingsPayoutIntervalYears: 1 }));
    // No payout during the fixed term itself.
    expect(result.schedule.slice(0, 24).every((e) => e.lumpSumPaid === 0)).toBe(true);
    // First payout the month the fixed term ends (month 25), not delayed by a
    // full interval.
    expect(result.schedule[24].lumpSumPaid).toBeGreaterThan(0);
    // Not again until a full interval (1 year = 12 months) has passed.
    expect(result.schedule.slice(25, 36).every((e) => e.lumpSumPaid === 0)).toBe(true);
    // Repeats every 12 months after that (month 37).
    expect(result.schedule[36].lumpSumPaid).toBeGreaterThan(0);
  });

  it('supports fractional years — 0.25 for 3 months, 0.5 for 6 months', () => {
    const quarterly = calculateMortgage(payoutInputs({ savingsPayoutIntervalYears: 0.25 }));
    // First payout month 25, next 3 months later at month 28.
    expect(quarterly.schedule[24].lumpSumPaid).toBeGreaterThan(0);
    expect(quarterly.schedule.slice(25, 27).every((e) => e.lumpSumPaid === 0)).toBe(true);
    expect(quarterly.schedule[27].lumpSumPaid).toBeGreaterThan(0); // month 28

    const semiAnnual = calculateMortgage(payoutInputs({ savingsPayoutIntervalYears: 0.5 }));
    expect(semiAnnual.schedule[24].lumpSumPaid).toBeGreaterThan(0);
    expect(semiAnnual.schedule.slice(25, 30).every((e) => e.lumpSumPaid === 0)).toBe(true);
    expect(semiAnnual.schedule[30].lumpSumPaid).toBeGreaterThan(0); // month 31
  });

  it('a shorter payout interval pays out more often than a longer one', () => {
    const frequent = calculateMortgage(payoutInputs({ savingsPayoutIntervalYears: 0.5 }));
    const infrequent = calculateMortgage(payoutInputs({ savingsPayoutIntervalYears: 2 }));
    const payoutCount = (r: typeof frequent) => r.schedule.filter((e) => e.lumpSumPaid > 0).length;
    expect(payoutCount(frequent)).toBeGreaterThan(payoutCount(infrequent));
  });

  it('reports unallocated savings when there is no room to ever leave the fixed term', () => {
    const result = calculateMortgage(payoutInputs({ fixedTermMonths: 300, totalTermMonths: 300 }));
    expect(result.unallocatedSavingsPot).toBeGreaterThan(0);
    expect(result.schedule.every((e) => e.lumpSumPaid === 0)).toBe(true);
  });

  it('conserves every pound of banked savings when a payout overshoots the payoff month', () => {
    // Regression: when the intended overpayment (recurring pool contribution +
    // a payout) exceeds the remaining balance on the final month, the engine
    // used to clip it to the balance and silently drop the overshoot. With a
    // huge pool against a tiny loan, that dropped hundreds of thousands of
    // pounds of the borrower's own banked savings out of the reported total.
    // In 'auto' mode with no manual lump sums, no pocket money is injected, so
    // every pound of freed-up pool money must land either on the mortgage
    // (totalOverpaid) or in the unallocated savings pot — nothing may vanish.
    const inputs = payoutInputs({
      savingsPayoutIntervalYears: 1,
      propertyValue: 120_000,
      deposit: 60_000,
      currentRent: 20_000,
      monthlySavings: 10_000,
    });
    const result = calculateMortgage(inputs);
    const pool = (inputs.currentRent ?? 0) + (inputs.monthlySavings ?? 0);
    // Pool money freed up each active month, in pence to match the engine.
    const poolInPence = result.schedule.reduce(
      (sum, e) => sum + Math.max(0, Math.round(pool * 100) - Math.round(e.scheduledPayment * 100)),
      0,
    );
    const accountedPence =
      Math.round(result.totalOverpaid * 100) + Math.round(result.unallocatedSavingsPot * 100);
    expect(poolInPence - accountedPence).toBe(0);
    // And the overshoot really is large here — guards against the test passing
    // only because the scenario is trivial.
    expect(result.unallocatedSavingsPot).toBeGreaterThan(500_000);
  });
});

describe('calculateMortgage — savings payout, cycling into new fixed deals (cycle-boundary timed)', () => {
  function cyclingPayoutInputs(overrides: Partial<MortgageInputs> = {}): MortgageInputs {
    return baseInputs({
      totalTermMonths: 300,
      fixedTermMonths: 24,
      variableRateAnnualPct: 7.25,
      currentRent: 5000,
      monthlySavings: 0,
      monthlyOverpaymentAmountMode: 'none',
      bankedSavingsDestination: 'lumpSumEachCycle',
      rateAfterFixedTermMode: 'remortgageToNewFixed',
      remortgageGapMonths: 2,
      ...overrides,
    });
  }

  it('pays out the month immediately after each fixed deal ends, repeating every cycle — ignoring savingsPayoutIntervalYears entirely', () => {
    // mode 'none' (no competing recurring overpayment) isolates the payout
    // mechanism's timing: with cycling active, a payout should land right after
    // each remortgage point regardless of any calendar interval set.
    const result = calculateMortgage(cyclingPayoutInputs({ savingsPayoutIntervalYears: 5 }));
    // Cycle boundaries at months 24 and 50 (26-month cycle: 24 fixed + 2 gap) —
    // payouts land the month immediately after each one, not tied to the
    // (deliberately huge, 5-year) interval above.
    expect(result.schedule.slice(0, 24).every((e) => e.lumpSumPaid === 0)).toBe(true);
    expect(result.schedule[24].lumpSumPaid).toBeGreaterThan(0); // month 25
    expect(result.schedule[50].lumpSumPaid).toBeGreaterThan(0); // month 51
    expect(result.totalErcPaid).toBe(0);
  });

  it('never triggers an ERC, re-metering the payout against the allowance even when it lands inside a subsequent fixed deal', () => {
    const result = calculateMortgage(
      cyclingPayoutInputs({
        config: { annualOverpaymentAllowancePct: 10, ercRateOnExcessPct: 3, ercAppliesDuringFixedTermOnly: false },
      }),
    );
    expect(result.totalErcPaid).toBe(0);
  });

  it('a zero-month gap means never leaving the fixed tie-in, so payouts stay allowance-capped instead of dumping in full', () => {
    // Confirms the same reasoning as the original (pre-decoupling) design: no gap
    // => no genuine penalty-free window, so a payout still fires at each cycle
    // boundary (previousMonthWasFixedPeriodBoundary still flips true) but stays
    // capped by the allowance every time rather than getting a free pass, since
    // the rate itself never actually leaves the fixed regime.
    const result = calculateMortgage(cyclingPayoutInputs({ remortgageGapMonths: 0 }));
    expect(result.schedule.every((e) => e.ratePct === 5)).toBe(true);
    expect(result.schedule[24].lumpSumPaid).toBeGreaterThan(0); // month 25: capped payout
    expect(result.totalErcPaid).toBe(0);
    // Capped every cycle, so savings pile up rather than fully clearing.
    expect(result.unallocatedSavingsPot).toBeGreaterThan(0);
  });
});
