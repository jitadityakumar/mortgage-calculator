import { beforeEach, vi } from 'vitest';
import { computeHasOverpayments } from '../hasOverpayments';
import type {
  ComparisonResult,
  MonthlyPaymentPeriod,
  MonthlyScheduleEntry,
  MortgageDefaults,
  MortgageInputs,
  MortgageResult,
  SavedCalculationDetail,
  SavedCalculationSummary,
} from '../api/types';

// Mirrors backend/app/engine/defaults.json — kept in sync by hand here since
// the mock can't fetch the real file; if these drift, App.test.tsx keeps
// passing but the mocked pre-fill diverges from what a real backend serves.
export const MOCK_DEFAULTS: MortgageDefaults = {
  config: {
    annualOverpaymentAllowancePct: 10,
    allowanceBasis: 'outstanding',
    ercRateOnExcessPct: 3,
    ercAppliesDuringFixedTermOnly: true,
    arrangementFee: 0,
    arrangementFeeAddedToLoan: false,
  },
  variableRateAnnualPct: 7.25,
  remortgageGapMonths: 2,
  savingsPayoutIntervalMonths: 6,
  fixedRateAnnualPct: 4.5,
  fixedTermMonths: 60,
  totalTermMonths: 300,
  deposit: 80_000,
  depositSavings: 90_000,
  isFirstTimeBuyer: true,
  deriveDepositFromSavings: true,
  overpaymentMode: 'reduceTerm',
  currentRent: 2300,
  monthlySavings: 2000,
  serviceCharge: 500,
  monthlyOverpaymentAmountMode: 'auto',
  fixedMonthlyOverpayment: 300,
  targetAllowanceUtilizationPct: 50,
  bankedSavingsDestination: 'lumpSumEachCycle',
  rateAfterFixedTermMode: 'remortgageToNewFixed',
  updatedAt: null,
};

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

  const monthlyPayments: MonthlyPaymentPeriod[] = [{ fromMonth: 1, payment: initialMonthlyPayment, isVariable: false }];
  if (fixedTermMonths > 0 && fixedTermMonths < totalTermMonths) {
    monthlyPayments.push({
      fromMonth: fixedTermMonths + 1,
      payment: initialMonthlyPayment * 1.1,
      isVariable: true,
    });
  }

  return {
    schedule,
    principal,
    monthlyPayments,
    rateAfterFixedTermMode: inputs.rateAfterFixedTermMode ?? MOCK_DEFAULTS.rateAfterFixedTermMode,
    payoffMonth,
    totalInterestPaid,
    totalPrincipalPaid: principal,
    totalOverpaid,
    totalErcPaid: 0,
    totalRepaid: principal + totalInterestPaid + totalOverpaid,
    totalPaid: inputs.propertyValue + totalInterestPaid,
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

// Lets a test simulate GET /api/v1/defaults failing (e.g. App.tsx's
// defaultsError branch), without needing a separate fetch mock per test.
// Reset before every test so a failure simulated in one test can't leak
// into the next.
let defaultsShouldFail = false;

export function setDefaultsShouldFail(shouldFail: boolean) {
  defaultsShouldFail = shouldFail;
}

// Mutable "current" defaults for the admin page's GET/PUT/reset round trip —
// separate from the immutable MOCK_DEFAULTS constant so a PUT in one test
// can't leak into another. Reset before every test.
let currentDefaults: MortgageDefaults = { ...MOCK_DEFAULTS };
let defaultsPutShouldFail = false;

export function setDefaultsPutShouldFail(shouldFail: boolean) {
  defaultsPutShouldFail = shouldFail;
}

/** Lets a test override what GET /api/v1/defaults returns (e.g. a test
 * exercising deriveDepositFromSavings=false) without hand-rolling a whole
 * MortgageDefaults object. Call before rendering. */
export function setMockDefaultsOverride(overrides: Partial<MortgageDefaults>) {
  currentDefaults = { ...currentDefaults, ...overrides };
}

beforeEach(() => {
  savedCalculations = [];
  nextSavedId = 1;
  defaultsShouldFail = false;
  currentDefaults = { ...MOCK_DEFAULTS };
  defaultsPutShouldFail = false;
});

export function installMockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (method === 'GET' && url.endsWith('/api/v1/defaults')) {
        if (defaultsShouldFail) {
          return jsonResponse({ detail: 'Internal Server Error' }, 500);
        }
        return jsonResponse(currentDefaults);
      }

      if (method === 'PUT' && url.endsWith('/api/v1/defaults')) {
        if (defaultsPutShouldFail) {
          return jsonResponse({ detail: 'Invalid defaults', issues: ['Default deposit cannot be negative.'] }, 400);
        }
        const body = JSON.parse((init?.body as string) ?? '{}') as MortgageDefaults;
        currentDefaults = { ...body, updatedAt: new Date().toISOString() };
        return jsonResponse(currentDefaults);
      }

      if (method === 'POST' && url.endsWith('/api/v1/defaults/reset')) {
        currentDefaults = { ...MOCK_DEFAULTS, updatedAt: new Date().toISOString() };
        return jsonResponse(currentDefaults);
      }

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
