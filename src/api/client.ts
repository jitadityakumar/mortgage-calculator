import type {
  ComparisonResult,
  MortgageDefaults,
  MortgageInputs,
  MortgageResult,
  SavedCalculationDetail,
  SavedCalculationSummary,
} from './types';

const API_BASE = '/api/v1';

/** Thrown for a 400 response — the backend's MortgageValidationError, surfaced
 * with the same `issues` list the deleted client-side validator used to
 * produce, so ValidationErrors.tsx doesn't need to change. */
export class ApiValidationError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(`Invalid mortgage inputs: ${issues.join('; ')}`);
    this.name = 'ApiValidationError';
    this.issues = issues;
  }
}

async function sendJson<T>(
  method: 'POST' | 'PUT',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  if (response.status === 400) {
    // A 400 from something other than FastAPI's MortgageValidationError
    // handler (e.g. a proxy/nginx error page) wouldn't be JSON — fall back
    // to a generic error rather than letting a SyntaxError escape uncaught.
    try {
      const data = await response.json();
      throw new ApiValidationError(data.issues ?? [data.detail ?? 'Invalid input.']);
    } catch (err) {
      if (err instanceof ApiValidationError) throw err;
      throw new Error(`Request to ${path} failed with status 400 and a non-JSON body`);
    }
  }
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return sendJson<T>('POST', path, body, signal);
}

function putJson<T>(path: string, body: unknown): Promise<T> {
  return sendJson<T>('PUT', path, body);
}

export function calculateMortgage(inputs: MortgageInputs, signal?: AbortSignal): Promise<MortgageResult> {
  return postJson<MortgageResult>('/calculate', inputs, signal);
}

export function compareWithAndWithoutOverpayments(
  inputs: MortgageInputs,
  signal?: AbortSignal,
): Promise<ComparisonResult> {
  return postJson<ComparisonResult>('/compare', inputs, signal);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function fetchDefaults(): Promise<MortgageDefaults> {
  return getJson<MortgageDefaults>('/defaults');
}

/** Admin-only write path (see AdminPage.tsx) — surfaces a 400 as
 * ApiValidationError the same way calculate/compare do, since the backend's
 * PUT /defaults raises the same MortgageValidationError shape. */
export function updateDefaults(defaults: MortgageDefaults): Promise<MortgageDefaults> {
  return putJson<MortgageDefaults>('/defaults', defaults);
}

export function resetDefaults(): Promise<MortgageDefaults> {
  return postJson<MortgageDefaults>('/defaults/reset', undefined);
}

export function listSavedCalculations(): Promise<SavedCalculationSummary[]> {
  return getJson<SavedCalculationSummary[]>('/saved-calculations');
}

export function getSavedCalculation(id: number): Promise<SavedCalculationDetail> {
  return getJson<SavedCalculationDetail>(`/saved-calculations/${id}`);
}

export async function saveCalculation(name: string, inputs: MortgageInputs): Promise<SavedCalculationSummary> {
  const response = await fetch(`${API_BASE}/saved-calculations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, inputs }),
  });
  if (!response.ok) {
    throw new Error(`Saving the calculation failed with status ${response.status}`);
  }
  return response.json() as Promise<SavedCalculationSummary>;
}

export async function deleteSavedCalculation(id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/saved-calculations/${id}`, { method: 'DELETE' });
  // DELETE is idempotent — a 404 means the end state the caller wanted
  // (this id no longer exists) is already true, e.g. a double-click firing
  // two deletes in a row. Only a genuine failure should reject.
  if (!response.ok && response.status !== 404) {
    throw new Error(`Deleting the saved calculation failed with status ${response.status}`);
  }
}
