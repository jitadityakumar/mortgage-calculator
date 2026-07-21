import type { FormState } from '../types/formState';
import { NumberField } from './NumberField';

interface CoreInputsFormProps {
  form: FormState;
  update: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
}

export function CoreInputsForm({ form, update }: CoreInputsFormProps) {
  return (
    <fieldset className="card">
      <legend>Mortgage details</legend>
      <div className="field-grid">
        <NumberField
          label="Property value"
          prefix="£"
          value={form.propertyValue}
          onChange={(v) => update('propertyValue', v)}
          step="1000"
        />
        <NumberField
          label="Deposit"
          prefix="£"
          value={form.deposit}
          onChange={(v) => update('deposit', v)}
          step="1000"
        />
        <NumberField
          label="Fixed-rate"
          suffix="% APR"
          value={form.fixedRatePct}
          onChange={(v) => update('fixedRatePct', v)}
          step="0.05"
        />
        <NumberField
          label="Fixed-rate period"
          suffix="years"
          value={form.fixedTermYears}
          onChange={(v) => update('fixedTermYears', v)}
          step="1"
        />
        <NumberField
          label="Variable (follow-on) rate"
          suffix="% APR"
          value={form.variableRatePct}
          onChange={(v) => update('variableRatePct', v)}
          step="0.05"
          hint="Typically the lender's SVR — check your real deal; ~7–7.5% is a rough current average."
        />
        <NumberField
          label="Total mortgage term"
          suffix="years"
          value={form.totalTermYears}
          onChange={(v) => update('totalTermYears', v)}
          step="1"
        />
      </div>
      <p className="field-hint">
        Your actual rate depends on your loan-to-value band and the lender/broker you use — this
        tool doesn't estimate market rates for you, only what a given rate means for your repayments.
      </p>
    </fieldset>
  );
}
