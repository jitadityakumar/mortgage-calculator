import { DEFAULT_REMORTGAGE_GAP_MONTHS, DEFAULT_SAVINGS_PAYOUT_INTERVAL_YEARS, resolveConfig } from './config';
import { poundsToPence, penceToPounds } from './money';
import type {
  ComparisonResult,
  MonthlyScheduleEntry,
  MortgageConfig,
  MortgageInputs,
  MortgageResult,
  OverpaymentMode,
  RateAfterFixedTermMode,
} from './types';
import { MortgageValidationError } from './types';
import { validateInputs } from './validate';

function pctToMonthlyRate(annualPct: number): number {
  return annualPct / 100 / 12;
}

/** Standard annuity formula, in integer pence. Handles the 0%-rate special case. */
function calcMonthlyPaymentPence(
  balancePence: number,
  monthlyRate: number,
  remainingMonths: number,
): number {
  if (remainingMonths <= 0) return balancePence;
  if (monthlyRate === 0) {
    return Math.round(balancePence / remainingMonths);
  }
  const factor = Math.pow(1 + monthlyRate, remainingMonths);
  const payment = (balancePence * (monthlyRate * factor)) / (factor - 1);
  return Math.round(payment);
}

function computeAllowanceLimitPence(
  balancePence: number,
  originalPrincipalPence: number,
  config: MortgageConfig,
): number {
  const basisBalance = config.allowanceBasis === 'original' ? originalPrincipalPence : balancePence;
  return Math.round((basisBalance * config.annualOverpaymentAllowancePct) / 100);
}

export function calculateMortgage(inputs: MortgageInputs): MortgageResult {
  const issues = validateInputs(inputs);
  if (issues.length > 0) {
    throw new MortgageValidationError(issues);
  }

  const config = resolveConfig(inputs.config);
  const mode: OverpaymentMode = inputs.overpaymentMode ?? 'reduceTerm';
  const warnings: string[] = [];

  const feePence = poundsToPence(config.arrangementFee);
  const basePrincipalPence = poundsToPence(inputs.propertyValue - inputs.deposit);
  const principalPence = basePrincipalPence + (config.arrangementFeeAddedToLoan ? feePence : 0);

  const fixedMonthlyRate = pctToMonthlyRate(inputs.fixedRateAnnualPct);
  const totalTermMonths = inputs.totalTermMonths;
  const fixedTermMonths = inputs.fixedTermMonths;

  const initialMonthlyPaymentPence = calcMonthlyPaymentPence(
    principalPence,
    fixedMonthlyRate,
    totalTermMonths,
  );

  const overpaymentAmountMode = inputs.monthlyOverpaymentAmountMode ?? 'none';
  // Conservative engine-level default: periodic savings payouts only kick in when
  // a caller actively opts in. The app itself defaults its own form state to
  // 'lumpSumEachCycle' once rent/savings are in play.
  const bankedDestination = inputs.bankedSavingsDestination ?? 'keepAsSavings';
  // 'lumpSumEachCycle' only, and only relevant when NOT cycling back into new
  // fixed deals: how often (in months, converted from the years input so 0.25/0.5
  // can express 3/6 months) the banked pot pays out once past the initial fixed
  // term. When cycling is active, payout timing instead follows the remortgage
  // cycle itself (see isSavingsPayoutMonth below) — this interval is ignored.
  const savingsPayoutIntervalMonths = Math.max(
    1,
    Math.round((inputs.savingsPayoutIntervalYears ?? DEFAULT_SAVINGS_PAYOUT_INTERVAL_YEARS) * 12),
  );
  const fixedMonthlyOverpaymentPence = poundsToPence(inputs.fixedMonthlyOverpayment ?? 0);
  const targetUtilizationPct = inputs.targetAllowanceUtilizationPct ?? 100;
  // Total budget that funded rent + existing saving before the mortgage, less any
  // recurring service charge taken out of savings. Once the mortgage payment
  // replaces rent, whatever's left of this pool each month is "new" money — see
  // MonthlyOverpaymentAmountMode for the full reasoning.
  const monthlyBudgetPoolPence = Math.max(
    0,
    poundsToPence((inputs.currentRent ?? 0) + (inputs.monthlySavings ?? 0) - (inputs.serviceCharge ?? 0)),
  );

  // Conservative engine-level default, mirroring bankedSavingsDestination: rate
  // cycling only kicks in when a caller actively opts in. The app's own
  // DEFAULT_FORM_STATE defaults to 'remortgageToNewFixed'.
  const rateAfterFixedTermMode: RateAfterFixedTermMode = inputs.rateAfterFixedTermMode ?? 'stayOnVariable';
  // Rate cycling (repeated fixed -> gap-on-variable -> fixed ...) only makes sense
  // when the borrower intends to remortgage into a new fixed deal and there's a
  // genuine fixed period shorter than the full term. This also determines savings
  // payout timing (see isSavingsPayoutMonth below): while cycling, a payout only
  // makes sense at each genuine remortgage point (the one moment that's naturally
  // free of the fixed tie-in), not on an arbitrary calendar clock that could land
  // it back inside a freshly-locked new fixed deal.
  const cyclingActive =
    rateAfterFixedTermMode === 'remortgageToNewFixed' && fixedTermMonths > 0 && fixedTermMonths < totalTermMonths;
  const gapMonths = Math.max(0, Math.round(inputs.remortgageGapMonths ?? DEFAULT_REMORTGAGE_GAP_MONTHS));
  const cycleLength = fixedTermMonths + gapMonths;

  let savingsPotPence = 0;
  // Cycling only: whether the *previous* month was the last month of a fixed
  // portion — i.e. this month is the first one after a genuine remortgage point,
  // the moment a payout should land. Simpler and equally correct replacement for
  // the old lookahead Map: no snapshotting needed, just a one-month-lagged copy
  // of isFixedPeriodBoundary carried across iterations.
  let previousMonthWasFixedPeriodBoundary = false;

  const lumpSumsByMonth = new Map<number, number>();
  for (const lump of inputs.lumpSums ?? []) {
    lumpSumsByMonth.set(lump.atMonth, (lumpSumsByMonth.get(lump.atMonth) ?? 0) + poundsToPence(lump.amount));
  }

  let balance = principalPence;
  let currentPayment = initialMonthlyPaymentPence;
  let variablePeriodMonthlyPaymentPence = 0;
  let capturedVariablePeriodPayment = false;

  let allowanceLimitThisYear = computeAllowanceLimitPence(balance, principalPence, config);
  let allowanceUsedThisYear = 0;
  // Separate from allowanceUsedThisYear: tracks how much of 'auto' mode's own
  // self-imposed target has been used this year, regardless of whether ERC risk
  // currently applies. allowanceUsedThisYear only updates when allowanceApplies is
  // true (it exists purely to compute ERC exposure), so once permanently past the
  // fixed term with ercAppliesDuringFixedTermOnly: true, it would otherwise never
  // move again — 'auto' mode would keep thinking none of this year's target had
  // been used, and would ramp the monthly installment up every month chasing a
  // phantom unused target instead of pacing evenly.
  let autoTargetUsedThisYear = 0;

  const schedule: MonthlyScheduleEntry[] = [];
  let month = 1;
  let payoffMonth = totalTermMonths;

  let totalInterestPence = 0;
  let totalPrincipalPence = 0;
  let totalOverpaidPence = 0;
  let totalErcPence = 0;

  while (month <= totalTermMonths) {
    // Position within the current fixed/gap cycle (0-indexed). Without cycling,
    // this degrades to the original single fixed -> follow-on-forever schedule.
    const positionInCycle = cyclingActive ? (month - 1) % cycleLength : month - 1;
    const inFixedTieIn = cyclingActive ? positionInCycle < fixedTermMonths : month <= fixedTermMonths;
    const isVariablePeriod = !inFixedTieIn;
    const monthlyRate = isVariablePeriod ? pctToMonthlyRate(inputs.variableRateAnnualPct) : fixedMonthlyRate;
    const ratePctNow = isVariablePeriod ? inputs.variableRateAnnualPct : inputs.fixedRateAnnualPct;

    // Recast at every regime change (fixed -> gap, or gap -> next fixed): re-amortize
    // the actual remaining balance over the remaining term at the new rate.
    const isRegimeStart = cyclingActive
      ? month > 1 && (positionInCycle === 0 || positionInCycle === fixedTermMonths)
      : isVariablePeriod && month === fixedTermMonths + 1;
    if (isRegimeStart) {
      const remainingMonths = totalTermMonths - month + 1;
      currentPayment = calcMonthlyPaymentPence(balance, monthlyRate, remainingMonths);
      if (isVariablePeriod && !capturedVariablePeriodPayment) {
        variablePeriodMonthlyPaymentPence = currentPayment;
        capturedVariablePeriodPayment = true;
      }
    }

    // Overpayment allowance resets every 12 months from the start of the loan.
    if ((month - 1) % 12 === 0) {
      allowanceLimitThisYear = computeAllowanceLimitPence(balance, principalPence, config);
      allowanceUsedThisYear = 0;
      autoTargetUsedThisYear = 0;
    }

    const openingBalance = balance;
    const interest = Math.round(balance * monthlyRate);

    // Force exact payoff on the final scheduled month, absorbing any accumulated
    // rounding drift rather than leaving a fractional-penny remainder.
    const payment = month === totalTermMonths ? openingBalance + interest : Math.min(currentPayment, openingBalance + interest);
    const principalPortion = payment - interest;
    balance -= principalPortion;

    // Whether the penalty-free allowance (and therefore ERC risk) is in play this month at all.
    const allowanceApplies = !config.ercAppliesDuringFixedTermOnly || !isVariablePeriod;
    const manualLumpSumThisMonth = lumpSumsByMonth.get(month) ?? 0;

    // Effective savings this month: what's freed up now that a mortgage payment,
    // not rent, is going out, plus whatever was already being saved. Grows as the
    // payment falls over time (reducePayment mode, or a lower rate at a transition).
    const effectiveSavingsPence = Math.max(0, monthlyBudgetPoolPence - payment);

    // 'auto' mode's monthly pacing exists to spread overpayments so they stay
    // under the penalty-free allowance. When there's no ERC risk this month AND
    // the banked pot is already destined to be swept onto the mortgage as a
    // periodic lump sum (bankedDestination === 'lumpSumEachCycle'), the pacing
    // serves no purpose — the money reaches the mortgage either way, just later
    // and in one go — so skip the drip-feed and let it fully bank instead. When
    // there's no periodic payout mechanism (bankedDestination === 'keepAsSavings'),
    // keep pacing indefinitely: it's the only thing that ever gets money onto the
    // mortgage once the allowance itself no longer constrains anything.
    const autoPacingActive = allowanceApplies || bankedDestination !== 'lumpSumEachCycle';

    let recurringOverpaymentPence = 0;
    if (overpaymentAmountMode === 'fixed') {
      recurringOverpaymentPence = fixedMonthlyOverpaymentPence;
    } else if (overpaymentAmountMode === 'auto' && autoPacingActive) {
      // Spread the target evenly across the remaining months of the current
      // allowance year, rather than greedily maxing out savings each month
      // until the target is hit and then doing nothing for the rest of the
      // year. Recomputed monthly from *actual* usage so far (not the target
      // pace), so a month that under-shoots because savings ran short gets
      // its shortfall smoothed across the remaining months instead of lost.
      const targetAllowanceLimitThisYear = Math.round((allowanceLimitThisYear * targetUtilizationPct) / 100);
      const monthsRemainingInYear = 12 - ((month - 1) % 12);
      const remainingTargetPence = Math.max(
        0,
        targetAllowanceLimitThisYear - autoTargetUsedThisYear - manualLumpSumThisMonth,
      );
      const equalMonthlyInstallmentPence = Math.round(remainingTargetPence / monthsRemainingInYear);
      recurringOverpaymentPence = Math.min(effectiveSavingsPence, equalMonthlyInstallmentPence);
    }
    // Whatever the recurring mechanism didn't use still banks (informational, or
    // toward the next savings payout), regardless of amount mode. This is "how much
    // was saved this month" in the everyday sense — separate from savingsPotPence,
    // which is the running balance and can drop back to zero on a payout month.
    const savingsAddedThisMonthPence = Math.max(0, effectiveSavingsPence - recurringOverpaymentPence);
    savingsPotPence += savingsAddedThisMonthPence;

    // Two different payout triggers, depending on what the rate does after the
    // fixed term:
    // - Cycling (remortgageToNewFixed): pay out the month immediately after each
    //   remortgage point (previousMonthWasFixedPeriodBoundary) — the one moment
    //   each cycle that's genuinely free of the fixed tie-in, not an arbitrary
    //   calendar date that might land back inside the new fixed deal.
    //   savingsPayoutIntervalMonths is ignored in this case.
    // - Not cycling (stayOnVariable, or no room to cycle at all): the first
    //   payout lands the month the initial fixed term ends (fixedTermMonths + 1),
    //   then repeats every savingsPayoutIntervalMonths after that.
    // Either way, re-metered against the *real* remaining allowance (not the
    // user's target%) each time, since the point of paying it out is to clear the
    // bank penalty-free, not to further throttle it by a liquidity preference.
    const isSavingsPayoutMonth =
      bankedDestination === 'lumpSumEachCycle' &&
      (cyclingActive
        ? previousMonthWasFixedPeriodBoundary
        : month > fixedTermMonths && (month - fixedTermMonths - 1) % savingsPayoutIntervalMonths === 0);
    let payoutAppliedPence = 0;
    if (isSavingsPayoutMonth && savingsPotPence > 0) {
      const payoutDue = savingsPotPence;
      const remainingRealAllowance = Math.max(
        0,
        allowanceLimitThisYear - allowanceUsedThisYear - manualLumpSumThisMonth - recurringOverpaymentPence,
      );
      payoutAppliedPence = allowanceApplies ? Math.min(payoutDue, remainingRealAllowance) : payoutDue;
      savingsPotPence -= payoutAppliedPence;
    }

    const lumpSumComponentWanted = manualLumpSumThisMonth + payoutAppliedPence;
    const overpaymentWanted = recurringOverpaymentPence + lumpSumComponentWanted;
    const overpaymentApplied = Math.min(overpaymentWanted, balance);
    // Proportionally split the (rare, near-payoff) clipped total back into its
    // components purely for schedule display — totals below use overpaymentApplied
    // directly and are unaffected by this split's rounding.
    const clipRatio = overpaymentWanted > 0 ? overpaymentApplied / overpaymentWanted : 1;
    const lumpSumPaidForSchedule = Math.round(lumpSumComponentWanted * clipRatio);

    let ercCharged = 0;
    if (overpaymentApplied > 0 && allowanceApplies) {
      const remainingAllowance = Math.max(0, allowanceLimitThisYear - allowanceUsedThisYear);
      const withinAllowance = Math.min(overpaymentApplied, remainingAllowance);
      const excess = overpaymentApplied - withinAllowance;
      allowanceUsedThisYear += withinAllowance;
      if (excess > 0) {
        ercCharged = Math.round((excess * config.ercRateOnExcessPct) / 100);
      }
    }
    // Unconditional (unlike allowanceUsedThisYear above): 'auto' mode's target is a
    // self-imposed pacing goal, not just an ERC-avoidance mechanism, so every pound
    // actually applied this month counts against it regardless of whether ERC risk
    // currently exists.
    autoTargetUsedThisYear += overpaymentApplied;

    balance -= overpaymentApplied;
    if (balance < 0) balance = 0;

    // Clipping only ever happens on the final (payoff) month, when the intended
    // overpayment overshoots the remaining balance. The overshoot that came from
    // banked savings — the recurring pool contribution and/or a savings payout — was
    // never actually needed to clear the loan, so it must return to the borrower's
    // savings rather than vanish from the accounting. (A manual lump sum's clipped
    // portion is the borrower's own one-off cash, not banked pool money, so it's
    // left out of the pot here — the same pre-existing behaviour as an over-large
    // lump sum in any non-cycling scenario.)
    const overpaymentClippedPence = overpaymentWanted - overpaymentApplied;
    if (overpaymentClippedPence > 0) {
      const savingsSourcedPence = recurringOverpaymentPence + payoutAppliedPence;
      savingsPotPence += Math.min(overpaymentClippedPence, savingsSourcedPence);
    }

    // The last month of a fixed-rate portion, about to move onto the follow-on/
    // variable rate. Used for UI row shading/↷ in the amortization table, and
    // (via previousMonthWasFixedPeriodBoundary, one month lagged) to drive the
    // cycling savings-payout trigger above.
    const isFixedPeriodBoundary = cyclingActive
      ? positionInCycle === fixedTermMonths - 1
      : fixedTermMonths > 0 && month === fixedTermMonths;

    // Note: reducePayment mode recalculates the required payment against the
    // *remaining original term* every time an overpayment lands, so the
    // borrower sees a visibly declining payment over time instead of a fixed
    // one. It cannot guarantee payoff lands exactly on totalTermMonths while
    // overpayments keep recurring — continuing to inject extra cash every
    // month necessarily pays the loan off somewhat earlier than the full
    // term, no matter how the payment is recalculated. What it does
    // guarantee is that it always pays off no earlier than reduceTerm mode
    // would for the same overpayment, since reduceTerm keeps the payment
    // (and therefore the total monthly cash in) at its original higher level
    // throughout.
    if (mode === 'reducePayment' && overpaymentApplied > 0 && balance > 0) {
      const remainingMonths = totalTermMonths - month;
      if (remainingMonths > 0) {
        currentPayment = calcMonthlyPaymentPence(balance, monthlyRate, remainingMonths);
      }
    }

    totalInterestPence += interest;
    totalPrincipalPence += principalPortion;
    totalOverpaidPence += overpaymentApplied;
    totalErcPence += ercCharged;

    schedule.push({
      month,
      ratePct: ratePctNow,
      openingBalance: penceToPounds(openingBalance),
      scheduledPayment: penceToPounds(payment),
      interestPaid: penceToPounds(interest),
      principalPaid: penceToPounds(principalPortion),
      overpaymentPaid: penceToPounds(overpaymentApplied),
      lumpSumPaid: penceToPounds(lumpSumPaidForSchedule),
      savingsAddedThisMonth: penceToPounds(savingsAddedThisMonthPence),
      savingsPotBalance: penceToPounds(savingsPotPence),
      isFixedPeriodBoundary,
      ercCharged: penceToPounds(ercCharged),
      closingBalance: penceToPounds(balance),
    });

    if (balance <= 0) {
      payoffMonth = month;
      break;
    }

    previousMonthWasFixedPeriodBoundary = isFixedPeriodBoundary;
    month++;
  }

  for (const lumpMonth of lumpSumsByMonth.keys()) {
    if (lumpMonth > payoffMonth) {
      warnings.push(
        `A lump sum scheduled for month ${lumpMonth} was ignored because the mortgage is already paid off by month ${payoffMonth}.`,
      );
    }
  }

  if (savingsPotPence > 0) {
    const potPounds = penceToPounds(savingsPotPence).toLocaleString('en-GB', { maximumFractionDigits: 0 });
    warnings.push(
      `You have £${potPounds} in banked savings that never reached a lump-sum payout point — it stays in your savings, not applied to the mortgage.`,
    );
  }

  return {
    schedule,
    principal: penceToPounds(principalPence),
    initialMonthlyPayment: penceToPounds(initialMonthlyPaymentPence),
    variablePeriodMonthlyPayment: penceToPounds(variablePeriodMonthlyPaymentPence),
    payoffMonth,
    totalInterestPaid: penceToPounds(totalInterestPence),
    totalPrincipalPaid: penceToPounds(totalPrincipalPence),
    totalOverpaid: penceToPounds(totalOverpaidPence),
    totalErcPaid: penceToPounds(totalErcPence),
    totalRepaid: penceToPounds(totalInterestPence + totalPrincipalPence + totalOverpaidPence + totalErcPence),
    monthsSavedVsOriginalTerm: totalTermMonths - payoffMonth,
    unallocatedSavingsPot: penceToPounds(savingsPotPence),
    warnings,
  };
}

export function compareWithAndWithoutOverpayments(inputs: MortgageInputs): ComparisonResult {
  const withOverpayments = calculateMortgage(inputs);
  const withoutOverpayments = calculateMortgage({
    ...inputs,
    lumpSums: [],
    monthlyOverpaymentAmountMode: 'none',
    bankedSavingsDestination: 'keepAsSavings',
  });

  return {
    withOverpayments,
    withoutOverpayments,
    interestSaved: withoutOverpayments.totalInterestPaid - withOverpayments.totalInterestPaid,
    monthsSaved: withoutOverpayments.payoffMonth - withOverpayments.payoffMonth,
  };
}
