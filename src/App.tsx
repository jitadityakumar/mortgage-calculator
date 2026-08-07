import { useEffect, useMemo, useState } from 'react';
import './App.css';
import { AdvancedConfig } from './components/AdvancedConfig';
import { AmortizationTable } from './components/AmortizationTable';
import { BalanceChart } from './components/BalanceChart';
import { CoreInputsForm } from './components/CoreInputsForm';
import { DebugState } from './components/DebugState';
import { OverpaymentsForm } from './components/OverpaymentsForm';
import { ResultsSummary } from './components/ResultsSummary';
import { SaveCalculation } from './components/SaveCalculation';
import { SavedCalculationsList } from './components/SavedCalculationsList';
import { SdltCalculator } from './components/SdltCalculator';
import { ValidationErrors } from './components/ValidationErrors';
import {
  ApiValidationError,
  compareWithAndWithoutOverpayments,
  fetchDefaults,
  getSavedCalculation,
} from './api/client';
import type { ComparisonResult, MortgageDefaults, MortgageInputs } from './api/types';
import { computeHasOverpayments } from './hasOverpayments';
import { mapFormStateToInputs, mapInputsToFormState } from './mapFormState';
import { buildDefaultFormState, type FormState } from './types/formState';

// Recalculation is now a network round-trip (the FE no longer calculates
// anything itself), so debounce it rather than firing on every keystroke.
const DEBOUNCE_MS = 300;

/** A comparison result bundled with the hasOverpayments flag computed from
 * the *same* inputs that produced it — not the form's current (possibly
 * newer) inputs. Rendering off this pair, rather than off `comparison` and
 * live `inputs` separately, avoids a stale-render window where an old
 * comparison briefly gets shown alongside a hasOverpayments flag computed
 * from inputs the backend hasn't calculated for yet. */
interface ComparisonState {
  comparison: ComparisonResult;
  hasOverpayments: boolean;
  /** The exact inputs that produced `comparison` — SaveCalculation must save
   * these, not the form's live `inputs`, which may have already moved on to
   * a value the backend hasn't validated/computed for yet. */
  inputs: MortgageInputs;
}

/**
 * Fetches the shared defaults (GET /api/v1/defaults) before rendering the
 * actual form, so buildDefaultFormState() always has real values rather
 * than a hardcoded second copy of the backend's numbers (see issue #5
 * follow-up). Brief loading/error states here are the tradeoff for that.
 */
function App() {
  const [defaults, setDefaults] = useState<MortgageDefaults | null>(null);
  const [defaultsError, setDefaultsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDefaults()
      .then((d) => {
        if (!cancelled) setDefaults(d);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('Failed to load defaults:', err);
        setDefaultsError('Could not reach the calculation service. Please refresh to try again.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (defaultsError) {
    return (
      <div className="app-shell">
        <header>
          <h1>Mortgage calculator</h1>
        </header>
        <div className="card errors" role="alert">
          <h2>Something went wrong</h2>
          <p>{defaultsError}</p>
        </div>
      </div>
    );
  }

  if (!defaults) {
    return (
      <div className="app-shell">
        <header>
          <h1>Mortgage calculator</h1>
        </header>
        <p className="field-hint" aria-live="polite">
          Loading…
        </p>
      </div>
    );
  }

  return <MortgageCalculator defaults={defaults} />;
}

function MortgageCalculator({ defaults }: { defaults: MortgageDefaults }) {
  const [form, setForm] = useState<FormState>(() => buildDefaultFormState(defaults));
  const [result, setResult] = useState<ComparisonState | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [savedRefreshToken, setSavedRefreshToken] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const update = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleLoadSaved = async (id: number) => {
    setLoadError(null);
    try {
      const detail = await getSavedCalculation(id);
      setForm((prev) => mapInputsToFormState(detail.inputs, prev, defaults));
    } catch (err) {
      console.error('Failed to load saved calculation:', err);
      setLoadError('Could not load that saved calculation.');
    }
  };

  const inputs = useMemo(() => mapFormStateToInputs(form), [form]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);

    const timer = setTimeout(() => {
      compareWithAndWithoutOverpayments(inputs, controller.signal)
        .then((comparison) => {
          if (controller.signal.aborted) return;
          setResult({ comparison, hasOverpayments: computeHasOverpayments(inputs), inputs });
          setIssues([]);
          setNetworkError(null);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setResult(null);
          if (err instanceof ApiValidationError) {
            setIssues(err.issues);
            setNetworkError(null);
          } else {
            // Validation issues come back as a 400 with `issues` (handled
            // above); anything else here is a genuine network/server
            // problem, not a bad input — keep it out of `issues` so it isn't
            // rendered under ValidationErrors' "Check your inputs" heading.
            console.error('Unexpected error computing mortgage comparison:', err);
            setIssues([]);
            setNetworkError('Could not reach the calculation service. Please try again.');
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [inputs]);

  const comparison = result?.comparison ?? null;
  const hasOverpayments = result?.hasOverpayments ?? false;

  return (
    <div className="app-shell">
      <header>
        <h1>Mortgage calculator</h1>
        <p className="subtitle">
          For a mortgage in England. Figures are estimates, not financial advice.
        </p>
      </header>

      <div className="layout">
        <div className="form-column">
          <CoreInputsForm form={form} update={update} />
          <OverpaymentsForm
            form={form}
            update={update}
            initialMonthlyPayment={comparison?.withOverpayments.initialMonthlyPayment}
          />
          <AdvancedConfig form={form} update={update} />
          <SdltCalculator
            propertyValue={inputs.propertyValue}
            deposit={inputs.deposit}
            isFirstTimeBuyer={form.isFirstTimeBuyer}
            onIsFirstTimeBuyerChange={(v) => update('isFirstTimeBuyer', v)}
          />
          <SavedCalculationsList refreshToken={savedRefreshToken} onLoad={handleLoadSaved} />
          <DebugState form={form} onImport={setForm} />
        </div>

        <div className="results-column">
          <ValidationErrors issues={issues} />
          {(loadError || networkError) && (
            <div className="card errors" role="alert">
              <h2>Something went wrong</h2>
              {loadError && <p>{loadError}</p>}
              {networkError && <p>{networkError}</p>}
            </div>
          )}
          {isLoading && <p className="field-hint" aria-live="polite">Calculating…</p>}
          <SaveCalculation
            inputs={result?.inputs ?? inputs}
            canSave={result !== null && !isLoading}
            onSaved={() => setSavedRefreshToken((t) => t + 1)}
          />
          {comparison && (
            <>
              <ResultsSummary comparison={comparison} hasOverpayments={hasOverpayments} />
              <BalanceChart
                withSchedule={comparison.withOverpayments.schedule}
                withoutSchedule={hasOverpayments ? comparison.withoutOverpayments.schedule : undefined}
              />
              <AmortizationTable schedule={comparison.withOverpayments.schedule} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
