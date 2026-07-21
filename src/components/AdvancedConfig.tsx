import type { FormState } from '../types/formState';
import { NumberField } from './NumberField';

interface AdvancedConfigProps {
  form: FormState;
  update: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
}

export function AdvancedConfig({ form, update }: AdvancedConfigProps) {
  return (
    <fieldset className="card">
      <legend>
        <button type="button" className="disclosure" onClick={() => update('showAdvanced', !form.showAdvanced)}>
          {form.showAdvanced ? '▾' : '▸'} Advanced assumptions (defaults are estimates — verify against your real offer)
        </button>
      </legend>
      {form.showAdvanced && (
        <>
          <div className="field-grid">
            <NumberField
              label="Penalty-free overpayment allowance"
              suffix="% / year"
              value={form.annualOverpaymentAllowancePct}
              onChange={(v) => update('annualOverpaymentAllowancePct', v)}
              step="1"
            />
            <label className="field">
              <span className="field-label">Allowance calculated against</span>
              <select
                value={form.allowanceBasis}
                onChange={(e) => update('allowanceBasis', e.target.value as FormState['allowanceBasis'])}
              >
                <option value="outstanding">Outstanding balance each year</option>
                <option value="original">Original loan amount</option>
              </select>
            </label>
            <NumberField
              label="Early Repayment Charge on excess"
              suffix="%"
              value={form.ercRateOnExcessPct}
              onChange={(v) => update('ercRateOnExcessPct', v)}
              step="0.5"
            />
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={form.ercAppliesDuringFixedTermOnly}
                onChange={(e) => update('ercAppliesDuringFixedTermOnly', e.target.checked)}
              />
              <span>ERC only applies during the fixed-rate period</span>
            </label>
            <NumberField
              label="Arrangement / product fee"
              prefix="£"
              value={form.arrangementFee}
              onChange={(v) => update('arrangementFee', v)}
              step="50"
            />
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={form.arrangementFeeAddedToLoan}
                onChange={(e) => update('arrangementFeeAddedToLoan', e.target.checked)}
              />
              <span>Add fee to the loan (instead of paying upfront)</span>
            </label>
          </div>
          <p className="field-hint">
            Real lenders vary on all of these — a typical UK deal allows ~10% penalty-free
            overpayment per year with a 1–5% charge on the excess during the fixed period only.
            Treat these as illustrative, not advice.
          </p>
        </>
      )}
    </fieldset>
  );
}
