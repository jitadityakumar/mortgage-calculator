import type { FormState } from '../types/formState';
import { NumberField } from './NumberField';
import { InfoIcon } from './InfoIcon';

interface CoreInputsFormProps {
  form: FormState;
  update: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
  updateDepositDriver: <K extends 'depositSavings' | 'propertyValue' | 'isFirstTimeBuyer'>(
    field: K,
    value: FormState[K],
  ) => void;
}

export function CoreInputsForm({ form, update, updateDepositDriver }: CoreInputsFormProps) {
  return (
    <fieldset className="card">
      <legend>Mortgage details</legend>
      <div className="field-grid">
        <NumberField
          label="Property value"
          prefix="£"
          value={form.propertyValue}
          onChange={(v) => updateDepositDriver('propertyValue', v)}
          step="1000"
        />
        <NumberField
          label="Deposit savings"
          prefix="£"
          value={form.depositSavings}
          onChange={(v) => updateDepositDriver('depositSavings', v)}
          step="1000"
          labelHint="Deposit auto-fills as this minus SDLT — edit deposit directly below to override."
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
          labelHint="Typically the lender's SVR — check your real deal; ~7–7.5% is a rough current average."
        />
        <NumberField
          label="Total mortgage term"
          suffix="years"
          value={form.totalTermYears}
          onChange={(v) => update('totalTermYears', v)}
          step="1"
        />
      </div>
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={form.isFirstTimeBuyer}
          onChange={(e) => updateDepositDriver('isFirstTimeBuyer', e.target.checked)}
        />
        <span>
          I'm a first-time buyer
          <InfoIcon text="Affects SDLT, which feeds the deposit auto-fill above." />
        </span>
      </label>
    </fieldset>
  );
}
