import { useMemo, useState } from 'react';
import './App.css';
import { AdvancedConfig } from './components/AdvancedConfig';
import { AmortizationTable } from './components/AmortizationTable';
import { BalanceChart } from './components/BalanceChart';
import { CoreInputsForm } from './components/CoreInputsForm';
import { DebugState } from './components/DebugState';
import { OverpaymentsForm } from './components/OverpaymentsForm';
import { ResultsSummary } from './components/ResultsSummary';
import { SdltCalculator } from './components/SdltCalculator';
import { ValidationErrors } from './components/ValidationErrors';
import { compareWithAndWithoutOverpayments, validateInputs } from './engine';
import { mapFormStateToInputs } from './mapFormState';
import { DEFAULT_FORM_STATE, type FormState } from './types/formState';

function App() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM_STATE);

  const update = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const inputs = useMemo(() => mapFormStateToInputs(form), [form]);
  const issues = useMemo(() => validateInputs(inputs), [inputs]);
  const comparison = useMemo(() => {
    if (issues.length > 0) return null;
    try {
      return compareWithAndWithoutOverpayments(inputs);
    } catch (err) {
      // Validation issues are already surfaced via `issues` above; this guards
      // against unexpected engine errors so the UI degrades to "no results"
      // instead of crashing.
      console.error('Unexpected error computing mortgage comparison:', err);
      return null;
    }
  }, [inputs, issues]);

  // Derived from the same parsed `inputs` the engine consumes, so this always
  // agrees with what actually gets passed to compareWithAndWithoutOverpayments.
  const overpaymentModeActive = (inputs.monthlyOverpaymentAmountMode ?? 'none') !== 'none';
  const lumpSumCycleActive =
    (inputs.bankedSavingsDestination ?? 'keepAsSavings') === 'lumpSumEachCycle' &&
    inputs.fixedTermMonths < inputs.totalTermMonths &&
    (inputs.currentRent ?? 0) + (inputs.monthlySavings ?? 0) > 0;
  const hasOverpayments = overpaymentModeActive || lumpSumCycleActive || (inputs.lumpSums ?? []).length > 0;

  return (
    <div className="app-shell">
      <header>
        <h1>Mortgage calculator</h1>
        <p className="subtitle">
          For a mortgage in England. Nothing you enter here is saved — figures are estimates, not
          financial advice.
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
          <DebugState form={form} onImport={setForm} />
        </div>

        <div className="results-column">
          <ValidationErrors issues={issues} />
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
