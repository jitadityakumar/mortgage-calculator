import { vi } from 'vitest';
import { computeHasOverpayments } from '../hasOverpayments';
import type { ComparisonResult, MonthlyScheduleEntry, MortgageInputs, MortgageResult } from '../api/types';

/**
 * Test-only stand-in for the FastAPI backend. App.test.tsx exercises UI
 * *structure* (does a results section appear, does a comparison table show
 * up, etc.) — never specific £ amounts — so this only needs to produce
 * plausible, correctly-shaped MortgageResult/ComparisonResult data, not the
 * real amortization algorithm. The real algorithm now lives solely in
 * backend/app/engine/ and is validated there (pytest suite); duplicating it
 * here would be exactly the kind of second "source of truth" this migration
 * was meant to eliminate.
 *
 * Uses the same computeHasOverpayments() predicate App.tsx uses to decide
 * whether to show the comparison view, so this mock can't silently diverge
 * from what the app itself considers "has overpayments".
 */

function buildResult(inputs: MortgageInputs, applyOverpayment: boolean): MortgageResult {
  const principal = Math.max(0, inputs.propertyValue - inputs.deposit);
  const totalTermMonths = Math.max(1, inputs.totalTermMonths);
  const fixedTermMonths = inputs.fixedTermMonths;
  const monthlyRate = inputs.fixedRateAnnualPct / 100 / 12;
  const initialMonthlyPayment =
    monthlyRate === 0 ? principal / totalTermMonths : (principal * monthlyRate) / (1 - (1 + monthlyRate) ** -totalTermMonths);

  const overpaying = applyOverpayment && computeHasOverpayments(inputs);
  // reduceTerm (default) pays off early — shorten the schedule. reducePayment
  // keeps the same term (payment falls instead), so schedule length must
  // match the no-overpayment baseline: a real regression this app guards
  // against (see the "shows the balance chart comparison line even when
  // reducePayment mode keeps the schedule length unchanged" test) would go
  // uncaught here otherwise.
  const overpaymentMode = inputs.overpaymentMode ?? 'reduceTerm';
  const reduction = overpaying && overpaymentMode !== 'reducePayment' ? Math.min(12, totalTermMonths - 1) : 0;
  const payoffMonth = totalTermMonths - reduction;

  const schedule: MonthlyScheduleEntry[] = Array.from({ length: payoffMonth }, (_, i) => {
    const month = i + 1;
    const openingBalance = principal * (1 - i / payoffMonth);
    const closingBalance = Math.max(0, principal * (1 - month / payoffMonth));
    const interestPaid = openingBalance * monthlyRate;
    return {
      month,
      ratePct: month <= fixedTermMonths ? inputs.fixedRateAnnualPct : inputs.variableRateAnnualPct,
      openingBalance,
      scheduledPayment: initialMonthlyPayment,
      interestPaid,
      principalPaid: initialMonthlyPayment - interestPaid,
      overpaymentPaid: overpaying ? 100 : 0,
      lumpSumPaid: (inputs.lumpSums?.length ?? 0) > 0 ? 50 : 0,
      savingsAddedThisMonth: 0,
      savingsPotBalance: 0,
      isFixedPeriodBoundary: fixedTermMonths > 0 && month === fixedTermMonths,
      ercCharged: 0,
      closingBalance,
    };
  });

  const totalInterestPaid = schedule.reduce((sum, e) => sum + e.interestPaid, 0);
  const totalOverpaid = schedule.reduce((sum, e) => sum + e.overpaymentPaid, 0);

  return {
    schedule,
    principal,
    initialMonthlyPayment,
    variablePeriodMonthlyPayment: fixedTermMonths > 0 && fixedTermMonths < totalTermMonths ? initialMonthlyPayment * 1.1 : 0,
    payoffMonth,
    totalInterestPaid,
    totalPrincipalPaid: principal,
    totalOverpaid,
    totalErcPaid: 0,
    totalRepaid: principal + totalInterestPaid + totalOverpaid,
    monthsSavedVsOriginalTerm: reduction,
    unallocatedSavingsPot: 0,
    warnings: [],
  };
}

function validationIssues(inputs: MortgageInputs): string[] {
  const issues: string[] = [];
  if (!(inputs.propertyValue > 0)) issues.push('Property value must be greater than 0.');
  if (inputs.deposit < 0) issues.push('Deposit cannot be negative.');
  if (inputs.propertyValue > 0 && inputs.deposit >= inputs.propertyValue) {
    issues.push('Deposit must be less than the property value (loan amount must be positive).');
  }
  return issues;
}

export function installMockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const inputs = JSON.parse((init?.body as string) ?? '{}') as MortgageInputs;
      const issues = validationIssues(inputs);

      if (issues.length > 0) {
        return new Response(JSON.stringify({ detail: 'Invalid mortgage inputs', issues }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/api/v1/compare')) {
        const withOverpayments = buildResult(inputs, true);
        const withoutOverpayments = buildResult(inputs, false);
        const body: ComparisonResult = {
          withOverpayments,
          withoutOverpayments,
          interestSaved: withoutOverpayments.totalInterestPaid - withOverpayments.totalInterestPaid,
          monthsSaved: withoutOverpayments.payoffMonth - withOverpayments.payoffMonth,
        };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (url.endsWith('/api/v1/calculate')) {
        const body = buildResult(inputs, true);
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      throw new Error(`Unmocked fetch call: ${url}`);
    }),
  );
}
