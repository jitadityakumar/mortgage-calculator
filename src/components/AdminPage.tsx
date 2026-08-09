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
  depositSavings: string;
  isFirstTimeBuyer: boolean;
  deriveDepositFromSavings: boolean;
  fixedRateAnnualPct: string;
  fixedTermYears: string;
  variableRateAnnualPct: string;
  totalTermYears: string;
  remortgageGapMonths: string;
  savingsPayoutIntervalMonths: string;
  overpaymentMode: OverpaymentMode;
  monthlyOverpaymentAmountMode: MonthlyOverpaymentAmountMode;
  fixedMonthlyOverpayment: string;
  targetAllowanceUtilizationPct: string;
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
    depositSavings: String(d.depositSavings),
    isFirstTimeBuyer: d.isFirstTimeBuyer,
    deriveDepositFromSavings: d.deriveDepositFromSavings,
    fixedRateAnnualPct: String(d.fixedRateAnnualPct),
    fixedTermYears: String(d.fixedTermMonths / 12),
    variableRateAnnualPct: String(d.variableRateAnnualPct),
    totalTermYears: String(d.totalTermMonths / 12),
    remortgageGapMonths: String(d.remortgageGapMonths),
    savingsPayoutIntervalMonths: String(d.savingsPayoutIntervalMonths),
    overpaymentMode: d.overpaymentMode,
    monthlyOverpaymentAmountMode: d.monthlyOverpaymentAmountMode,
    fixedMonthlyOverpayment: String(d.fixedMonthlyOverpayment),
    targetAllowanceUtilizationPct: String(d.targetAllowanceUtilizationPct),
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
    depositSavings: parseNum(form.depositSavings),
    isFirstTimeBuyer: form.isFirstTimeBuyer,
    deriveDepositFromSavings: form.deriveDepositFromSavings,
    fixedRateAnnualPct: parseNum(form.fixedRateAnnualPct),
    fixedTermMonths: Math.round(parseNum(form.fixedTermYears) * 12),
    variableRateAnnualPct: parseNum(form.variableRateAnnualPct),
    totalTermMonths: Math.round(parseNum(form.totalTermYears) * 12),
    remortgageGapMonths: parseNum(form.remortgageGapMonths),
    savingsPayoutIntervalMonths: Math.round(parseNum(form.savingsPayoutIntervalMonths)),
    overpaymentMode: form.overpaymentMode,
    monthlyOverpaymentAmountMode: form.monthlyOverpaymentAmountMode,
    fixedMonthlyOverpayment: parseNum(form.fixedMonthlyOverpayment),
    targetAllowanceUtilizationPct: parseNum(form.targetAllowanceUtilizationPct),
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
          <fieldset className="card">
            <legend>Mortgage details</legend>
            <div className="field-grid">
              <NumberField
                label="Deposit savings"
                prefix="£"
                value={form.depositSavings}
                onChange={(v) => update('depositSavings', v)}
                step="1000"
                hint="Starting value for the calculator's 'Deposit savings' field. Only feeds the deposit auto-fill while 'Derive deposit from savings' below is checked."
              />
              <NumberField
                label="Deposit"
                prefix="£"
                value={form.deposit}
                onChange={(v) => update('deposit', v)}
                step="1000"
                hint={
                  form.deriveDepositFromSavings
                    ? "Server-side fallback only for a partial /calculate request or a saved calculation — while 'Derive deposit from savings' is checked, the calculator's own pre-filled deposit is computed from Deposit savings minus SDLT instead of this value."
                    : "Used everywhere, including the calculator's own pre-filled deposit, since 'Derive deposit from savings' is unchecked."
                }
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
                suffix="years"
                value={form.fixedTermYears}
                onChange={(v) => update('fixedTermYears', v)}
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
                onChange={(e) => update('isFirstTimeBuyer', e.target.checked)}
              />
              <span>First-time buyer by default (affects SDLT, which feeds the deposit auto-fill)</span>
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={form.deriveDepositFromSavings}
                onChange={(e) => update('deriveDepositFromSavings', e.target.checked)}
              />
              <span>Derive deposit from savings (deposit auto-fills as Deposit savings minus SDLT, live as the user types)</span>
            </label>
          </fieldset>

          <fieldset className="card">
            <legend>Overpayments</legend>
            <div className="field-grid">
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
              <NumberField
                label="Fixed monthly overpayment"
                prefix="£"
                value={form.fixedMonthlyOverpayment}
                onChange={(v) => update('fixedMonthlyOverpayment', v)}
                step="50"
                hint="Used when 'Monthly overpayment amount' is 'Fixed amount' — also the calculator's initial pre-fill for that field."
              />
              <NumberField
                label="Target allowance utilization"
                suffix="%"
                value={form.targetAllowanceUtilizationPct}
                onChange={(v) => update('targetAllowanceUtilizationPct', v)}
                step="5"
                min="0"
                hint="Used when 'Monthly overpayment amount' is 'Auto' — also the calculator's initial pre-fill for that field."
              />
            </div>
          </fieldset>

          <fieldset className="card">
            <legend>Post fixed deal</legend>
            <div className="field-grid">
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
              <NumberField
                label="Savings payout interval"
                suffix="months"
                value={form.savingsPayoutIntervalMonths}
                onChange={(v) => update('savingsPayoutIntervalMonths', v)}
                step="1"
                min="1"
              />
              <NumberField
                label="Remortgage gap"
                suffix="months"
                value={form.remortgageGapMonths}
                onChange={(v) => update('remortgageGapMonths', v)}
                step="1"
                hint="Penalty-free variable-rate gap between fixed-rate cycles, when rate-cycling is on."
              />
            </div>
          </fieldset>

          <fieldset className="card">
            <legend>
              <span className="field-label">Advanced assumptions</span>
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
