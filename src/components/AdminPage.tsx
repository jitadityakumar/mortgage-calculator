import { useEffect, useState } from 'react';
import { ApiValidationError, fetchDefaults, resetDefaults, updateDefaults } from '../api/client';
import type {
  AllowanceBasis,
  BankedSavingsDestination,
  MonthlyOverpaymentAmountMode,
  MortgageDefaults,
  OverpaymentMode,
} from '../api/types';
import { parseNum } from '../format';
import { NumberField } from './NumberField';

/** Same shape as MortgageDefaults, but every number is kept as a string
 * while the user is editing — matching the main form's convention (see
 * NumberField's usage elsewhere) so an emptied field doesn't snap to "0"
 * (Number('') === 0) and block retyping. Parsed back to numbers only on
 * save, via parseNum. */
interface DefaultsFormState {
  deposit: string;
  fixedRateAnnualPct: string;
  fixedTermMonths: string;
  variableRateAnnualPct: string;
  totalTermMonths: string;
  remortgageGapMonths: string;
  savingsPayoutIntervalYears: string;
  overpaymentMode: OverpaymentMode;
  monthlyOverpaymentAmountMode: MonthlyOverpaymentAmountMode;
  bankedSavingsDestination: BankedSavingsDestination;
  annualOverpaymentAllowancePct: string;
  allowanceBasis: AllowanceBasis;
  ercRateOnExcessPct: string;
  ercAppliesDuringFixedTermOnly: boolean;
  arrangementFee: string;
  arrangementFeeAddedToLoan: boolean;
}

function toFormState(d: MortgageDefaults): DefaultsFormState {
  return {
    deposit: String(d.deposit),
    fixedRateAnnualPct: String(d.fixedRateAnnualPct),
    fixedTermMonths: String(d.fixedTermMonths),
    variableRateAnnualPct: String(d.variableRateAnnualPct),
    totalTermMonths: String(d.totalTermMonths),
    remortgageGapMonths: String(d.remortgageGapMonths),
    savingsPayoutIntervalYears: String(d.savingsPayoutIntervalYears),
    overpaymentMode: d.overpaymentMode,
    monthlyOverpaymentAmountMode: d.monthlyOverpaymentAmountMode,
    bankedSavingsDestination: d.bankedSavingsDestination,
    annualOverpaymentAllowancePct: String(d.config.annualOverpaymentAllowancePct),
    allowanceBasis: d.config.allowanceBasis,
    ercRateOnExcessPct: String(d.config.ercRateOnExcessPct),
    ercAppliesDuringFixedTermOnly: d.config.ercAppliesDuringFixedTermOnly,
    arrangementFee: String(d.config.arrangementFee),
    arrangementFeeAddedToLoan: d.config.arrangementFeeAddedToLoan,
  };
}

function toMortgageDefaults(form: DefaultsFormState): MortgageDefaults {
  return {
    deposit: parseNum(form.deposit),
    fixedRateAnnualPct: parseNum(form.fixedRateAnnualPct),
    fixedTermMonths: parseNum(form.fixedTermMonths),
    variableRateAnnualPct: parseNum(form.variableRateAnnualPct),
    totalTermMonths: parseNum(form.totalTermMonths),
    remortgageGapMonths: parseNum(form.remortgageGapMonths),
    savingsPayoutIntervalYears: parseNum(form.savingsPayoutIntervalYears),
    overpaymentMode: form.overpaymentMode,
    monthlyOverpaymentAmountMode: form.monthlyOverpaymentAmountMode,
    bankedSavingsDestination: form.bankedSavingsDestination,
    config: {
      annualOverpaymentAllowancePct: parseNum(form.annualOverpaymentAllowancePct),
      allowanceBasis: form.allowanceBasis,
      ercRateOnExcessPct: parseNum(form.ercRateOnExcessPct),
      ercAppliesDuringFixedTermOnly: form.ercAppliesDuringFixedTermOnly,
      arrangementFee: parseNum(form.arrangementFee),
      arrangementFeeAddedToLoan: form.arrangementFeeAddedToLoan,
    },
    updatedAt: null,
  };
}

export function AdminPage() {
  const [form, setForm] = useState<DefaultsFormState | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveIssues, setSaveIssues] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchDefaults()
      .then((d) => {
        if (cancelled) return;
        setForm(toFormState(d));
        setUpdatedAt(d.updatedAt);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('Failed to load defaults:', err);
        setLoadError('Could not reach the calculation service. Please refresh to try again.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = <K extends keyof DefaultsFormState>(field: K, value: DefaultsFormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleSave = async () => {
    if (!form) return;
    setIsSaving(true);
    setSaveIssues([]);
    setSaveError(null);
    setStatus(null);
    try {
      const saved = await updateDefaults(toMortgageDefaults(form));
      setForm(toFormState(saved));
      setUpdatedAt(saved.updatedAt);
      setStatus('Saved.');
    } catch (err) {
      if (err instanceof ApiValidationError) {
        setSaveIssues(err.issues);
      } else {
        console.error('Failed to save defaults:', err);
        setSaveError('Could not save — please try again.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset every default to the shipped values? This discards any tuning you’ve done here.')) {
      return;
    }
    setIsResetting(true);
    setSaveIssues([]);
    setSaveError(null);
    setStatus(null);
    try {
      const reset = await resetDefaults();
      setForm(toFormState(reset));
      setUpdatedAt(reset.updatedAt);
      setStatus('Reset to shipped defaults.');
    } catch (err) {
      console.error('Failed to reset defaults:', err);
      setSaveError('Could not reset — please try again.');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="app-shell">
      <header>
        <h1>Admin: shared defaults</h1>
        <p className="subtitle">
          These values are the single source of truth for both the calculator's form pre-fill and the
          API's fallback for any field a caller leaves unset. <a href="/">Back to calculator</a>
        </p>
      </header>

      {loadError && (
        <div className="card errors" role="alert">
          <h2>Something went wrong</h2>
          <p>{loadError}</p>
        </div>
      )}

      {!loadError && !form && (
        <p className="field-hint" aria-live="polite">
          Loading…
        </p>
      )}

      {form && (
        <>
          <div className="card">
            <div className="field-grid">
              <NumberField
                label="Deposit"
                prefix="£"
                value={form.deposit}
                onChange={(v) => update('deposit', v)}
                step="1000"
                hint="Server-side fallback only for a partial /calculate request or a saved calculation — does not change the calculator's own pre-filled deposit, which is computed from Deposit savings minus SDLT."
              />
              <NumberField
                label="Fixed rate"
                suffix="% / year"
                value={form.fixedRateAnnualPct}
                onChange={(v) => update('fixedRateAnnualPct', v)}
                step="0.1"
              />
              <NumberField
                label="Fixed term"
                suffix="months"
                value={form.fixedTermMonths}
                onChange={(v) => update('fixedTermMonths', v)}
                step="1"
              />
              <NumberField
                label="Variable / follow-on rate"
                suffix="% / year"
                value={form.variableRateAnnualPct}
                onChange={(v) => update('variableRateAnnualPct', v)}
                step="0.1"
              />
              <NumberField
                label="Total mortgage term"
                suffix="months"
                value={form.totalTermMonths}
                onChange={(v) => update('totalTermMonths', v)}
                step="1"
              />
              <NumberField
                label="Remortgage gap"
                suffix="months"
                value={form.remortgageGapMonths}
                onChange={(v) => update('remortgageGapMonths', v)}
                step="1"
                hint="Penalty-free variable-rate gap between fixed-rate cycles, when rate-cycling is on."
              />
              <NumberField
                label="Savings payout interval"
                suffix="years"
                value={form.savingsPayoutIntervalYears}
                onChange={(v) => update('savingsPayoutIntervalYears', v)}
                step="0.25"
              />
              <label className="field">
                <span className="field-label">When you overpay, it should...</span>
                <select
                  value={form.overpaymentMode}
                  onChange={(e) => update('overpaymentMode', e.target.value as OverpaymentMode)}
                >
                  <option value="reduceTerm">Reduce term (same payment, finish sooner)</option>
                  <option value="reducePayment">Reduce payment (same term, pay less monthly)</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">Monthly overpayment amount</span>
                <select
                  value={form.monthlyOverpaymentAmountMode}
                  onChange={(e) =>
                    update('monthlyOverpaymentAmountMode', e.target.value as MonthlyOverpaymentAmountMode)
                  }
                >
                  <option value="none">None</option>
                  <option value="fixed">Fixed amount</option>
                  <option value="auto">Auto (paced to the allowance)</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">Banked savings destination</span>
                <select
                  value={form.bankedSavingsDestination}
                  onChange={(e) => update('bankedSavingsDestination', e.target.value as BankedSavingsDestination)}
                >
                  <option value="lumpSumEachCycle">Pay out as a lump sum each cycle</option>
                  <option value="keepAsSavings">Keep as savings</option>
                </select>
              </label>
            </div>
          </div>

          <fieldset className="card">
            <legend>
              <span className="field-label">Overpayment allowance / ERC configuration</span>
            </legend>
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
                  onChange={(e) => update('allowanceBasis', e.target.value as AllowanceBasis)}
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
          </fieldset>

          {saveIssues.length > 0 && (
            <div className="card errors" role="alert">
              <h2>Check these values</h2>
              <ul>
                {saveIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
          {saveError && (
            <div className="card errors" role="alert">
              <h2>Something went wrong</h2>
              <p>{saveError}</p>
            </div>
          )}

          <div className="card">
            <div className="admin-actions">
              <button type="button" className="btn-secondary" onClick={handleSave} disabled={isSaving || isResetting}>
                {isSaving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn-secondary" onClick={handleReset} disabled={isSaving || isResetting}>
                {isResetting ? 'Resetting…' : 'Reset to shipped defaults'}
              </button>
            </div>
            {status && (
              <p className="field-hint" aria-live="polite">
                {status}
              </p>
            )}
            <p className="field-hint">{updatedAt ? `Last updated: ${new Date(updatedAt).toLocaleString()}` : 'Never edited — showing the shipped defaults.'}</p>
          </div>
        </>
      )}
    </div>
  );
}
