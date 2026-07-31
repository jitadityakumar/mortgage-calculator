import { beforeEach, vi } from 'vitest';
import { computeHasOverpayments } from '../hasOverpayments';
import type {
  ComparisonResult,
  MonthlyScheduleEntry,
  MortgageInputs,
  MortgageResult,
  SavedCalculationDetail,
  SavedCalculationSummary,
} from '../api/types';

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// In-memory stand-in for the saved_calculations table. Reset before every
// test (see beforeEach below) so saves in one test can't leak into another.
let savedCalculations: SavedCalculationDetail[] = [];
let nextSavedId = 1;

beforeEach(() => {
  savedCalculations = [];
  nextSavedId = 1;
});

export function installMockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      const savedMatch = url.match(/\/api\/v1\/saved-calculations(?:\/(\d+))?$/);

      if (savedMatch) {
        const id = savedMatch[1] ? Number(savedMatch[1]) : null;

        if (method === 'GET' && id === null) {
          const summaries: SavedCalculationSummary[] = savedCalculations.map((c) => ({
            id: c.id,
            name: c.name,
            createdAt: c.createdAt,
            propertyValue: c.inputs.propertyValue,
            deposit: c.inputs.deposit,
            totalTermMonths: c.inputs.totalTermMonths,
          }));
          return jsonResponse(summaries);
        }

        if (method === 'GET' && id !== null) {
          const found = savedCalculations.find((c) => c.id === id);
          return found ? jsonResponse(found) : jsonResponse({ detail: 'Not found.' }, 404);
        }

        if (method === 'POST') {
          const { name, inputs } = JSON.parse((init?.body as string) ?? '{}') as {
            name: string;
            inputs: MortgageInputs;
          };
          const record: SavedCalculationDetail = {
            id: nextSavedId++,
            name,
            createdAt: new Date().toISOString(),
            inputs,
          };
          savedCalculations.unshift(record);
          const summary: SavedCalculationSummary = {
            id: record.id,
            name: record.name,
            createdAt: record.createdAt,
            propertyValue: record.inputs.propertyValue,
            deposit: record.inputs.deposit,
            totalTermMonths: record.inputs.totalTermMonths,
          };
          return jsonResponse(summary, 201);
        }

        if (method === 'DELETE' && id !== null) {
          const existed = savedCalculations.some((c) => c.id === id);
          savedCalculations = savedCalculations.filter((c) => c.id !== id);
          return existed ? new Response(null, { status: 204 }) : jsonResponse({ detail: 'Not found.' }, 404);
        }
      }

      const inputs = JSON.parse((init?.body as string) ?? '{}') as MortgageInputs;
      const issues = validationIssues(inputs);

      if (issues.length > 0) {
        return jsonResponse({ detail: 'Invalid mortgage inputs', issues }, 400);
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
        return jsonResponse(body);
      }

      if (url.endsWith('/api/v1/calculate')) {
        return jsonResponse(buildResult(inputs, true));
      }

      throw new Error(`Unmocked fetch call: ${method} ${url}`);
    }),
  );
}
