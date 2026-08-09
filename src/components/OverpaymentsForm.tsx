import type { FormState, LumpSumFormRow } from '../types/formState';
import { formatGBP, parseNum } from '../format';
import { NumberField } from './NumberField';

interface OverpaymentsFormProps {
  form: FormState;
  update: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
  /** First month's scheduled mortgage payment, for the effective-savings preview. */
  initialMonthlyPayment?: number;
}

function newLumpSumRow(): LumpSumFormRow {
  return { id: crypto.randomUUID(), month: '', amount: '' };
}

export function OverpaymentsForm({ form, update, initialMonthlyPayment }: OverpaymentsFormProps) {
  const updateLumpSum = (id: string, patch: Partial<LumpSumFormRow>) => {
    update(
      'lumpSums',
      form.lumpSums.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  };

  const removeLumpSum = (id: string) => {
    update('lumpSums', form.lumpSums.filter((row) => row.id !== id));
  };

  const rentSavingsPool = Math.max(
    0,
    parseNum(form.currentRent) + parseNum(form.monthlySavings) - parseNum(form.serviceCharge),
  );
  const freedThisMonth =
    initialMonthlyPayment !== undefined ? Math.max(0, rentSavingsPool - initialMonthlyPayment) : undefined;
  const poolInUse = form.monthlyOverpaymentAmountMode !== 'none' || form.bankedSavingsDestination === 'lumpSumEachCycle';

  return (
    <>
    <fieldset className="card">
      <legend>Overpayments</legend>

      <div className="field-grid">
        <NumberField
          label="Current rent"
          prefix="£"
          value={form.currentRent}
          onChange={(v) => update('currentRent', v)}
          step="10"
          hint="What you pay in rent today — freed up once a mortgage payment replaces it."
        />
        <NumberField
          label="Current monthly savings"
          prefix="£"
          value={form.monthlySavings}
          onChange={(v) => update('monthlySavings', v)}
          step="10"
          hint="What you already save each month today, on top of rent."
        />
        <NumberField
          label="Service charge"
          prefix="£"
          value={form.serviceCharge}
          onChange={(v) => update('serviceCharge', v)}
          step="10"
          hint="Recurring monthly service charge/ground rent, taken out of your rent + savings pool before overpayments."
        />
      </div>

      <label className="field">
        <span className="field-label">When you overpay, it should...</span>
        <select
          value={form.overpaymentMode}
          onChange={(e) => update('overpaymentMode', e.target.value as FormState['overpaymentMode'])}
        >
          <option value="reduceTerm">Reduce term (same payment, finish sooner)</option>
          <option value="reducePayment">Reduce payment (same term, pay less monthly)</option>
        </select>
      </label>

      <div className="radio-group">
        <span className="field-label">Monthly overpayment amount</span>
        <label className="radio-field">
          <input
            type="radio"
            name="monthlyOverpaymentAmountMode"
            checked={form.monthlyOverpaymentAmountMode === 'none'}
            onChange={() => update('monthlyOverpaymentAmountMode', 'none')}
          />
          <span>None — don't overpay monthly (savings can still fund a lump sum below)</span>
        </label>
        <label className="radio-field">
          <input
            type="radio"
            name="monthlyOverpaymentAmountMode"
            checked={form.monthlyOverpaymentAmountMode === 'fixed'}
            onChange={() => update('monthlyOverpaymentAmountMode', 'fixed')}
          />
          <span>Fixed amount</span>
        </label>
        <label className="radio-field">
          <input
            type="radio"
            name="monthlyOverpaymentAmountMode"
            checked={form.monthlyOverpaymentAmountMode === 'auto'}
            onChange={() => update('monthlyOverpaymentAmountMode', 'auto')}
          />
          <span>Auto — calculate from savings</span>
        </label>
      </div>

      {form.monthlyOverpaymentAmountMode === 'fixed' && (
        <NumberField
          label="Fixed monthly overpayment"
          prefix="£"
          value={form.fixedMonthlyOverpayment}
          onChange={(v) => update('fixedMonthlyOverpayment', v)}
          step="10"
          hint="Applied every month regardless of the allowance — may incur an Early Repayment Charge if it's more than the lender allows penalty-free. Whatever's left of the pool below still banks."
        />
      )}

      {form.monthlyOverpaymentAmountMode === 'auto' && (
        <NumberField
          label="Use up to this % of my penalty-free allowance"
          suffix="%"
          value={form.targetAllowanceUtilizationPct}
          onChange={(v) => update('targetAllowanceUtilizationPct', v)}
          step="5"
          min="0"
          hint="Defaults to 50% of the lender's full allowance (set in Advanced assumptions). Spread evenly across the year's 12 months rather than maxed out early, so you don't stop overpaying partway through. Raise it toward 100% to use more of the allowance, or lower it to deliberately keep more in savings instead of overpaying."
        />
      )}

      {poolInUse && initialMonthlyPayment !== undefined && freedThisMonth !== undefined && (
        <p className="field-hint">
          Your first mortgage payment is {formatGBP(initialMonthlyPayment, true)}, leaving about{' '}
          <strong>{formatGBP(freedThisMonth, true)}/month</strong> free from your{' '}
          {formatGBP(rentSavingsPool, true)} rent + savings pool (after service charge) — this grows as your
          payment falls over time.
        </p>
      )}
      {poolInUse && (
        <p className="field-hint warning">
          Maximizing overpayments every month means less cash on hand for emergencies. Consider keeping an
          emergency fund (roughly 3–6 months of expenses) in accessible cash first, and compare against other
          savings/investment options — overpaid amounts aren't easily accessible again without further borrowing.
        </p>
      )}

      <div className="lump-sums">
        <div className="lump-sums-header">
          <span className="field-label">One-off lump sum overpayments</span>
          <button type="button" className="btn-secondary" onClick={() => update('lumpSums', [...form.lumpSums, newLumpSumRow()])}>
            + Add lump sum
          </button>
        </div>
        {form.lumpSums.length === 0 && <p className="field-hint">None added.</p>}
        {form.lumpSums.map((row) => (
          <div className="lump-sum-row" key={row.id}>
            <label className="field field-inline">
              <span className="field-label">Month #</span>
              <input
                type="number"
                min="1"
                value={row.month}
                onChange={(e) => updateLumpSum(row.id, { month: e.target.value })}
                placeholder="e.g. 12"
              />
            </label>
            <label className="field field-inline">
              <span className="field-label">Amount</span>
              <div className="field-input">
                <span className="field-affix">£</span>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={row.amount}
                  onChange={(e) => updateLumpSum(row.id, { amount: e.target.value })}
                  placeholder="e.g. 5000"
                />
              </div>
            </label>
            <button type="button" className="btn-remove" onClick={() => removeLumpSum(row.id)} aria-label="Remove lump sum">
              ✕
            </button>
          </div>
        ))}
      </div>
    </fieldset>

    <fieldset className="card">
      <legend>Post fixed deal</legend>

      <div className="radio-group">
        <span className="field-label">Once the fixed deal ends</span>
        <label className="radio-field">
          <input
            type="radio"
            name="rateAfterFixedTermMode"
            checked={form.rateAfterFixedTermMode === 'remortgageToNewFixed'}
            onChange={() => update('rateAfterFixedTermMode', 'remortgageToNewFixed')}
          />
          <span>Remortgage into a new fixed deal (repeats for the life of the loan)</span>
        </label>
        <label className="radio-field">
          <input
            type="radio"
            name="rateAfterFixedTermMode"
            checked={form.rateAfterFixedTermMode === 'stayOnVariable'}
            onChange={() => update('rateAfterFixedTermMode', 'stayOnVariable')}
          />
          <span>Move onto the variable rate and stay there</span>
        </label>
        <label className="radio-field">
          <input
            type="radio"
            name="rateAfterFixedTermMode"
            checked={form.rateAfterFixedTermMode === 'hybrid'}
            onChange={() => update('rateAfterFixedTermMode', 'hybrid')}
          />
          <span>
            Hybrid — check each time the fixed deal ends: if moving to variable now would clear the mortgage
            within another fixed deal's length, do that instead of remortgaging again
          </span>
        </label>
      </div>

      <div className="radio-group">
        <span className="field-label">What to do with pool money not overpaid monthly</span>
        <label className="radio-field">
          <input
            type="radio"
            name="bankedSavingsDestination"
            checked={form.bankedSavingsDestination === 'lumpSumEachCycle'}
            onChange={() => update('bankedSavingsDestination', 'lumpSumEachCycle')}
          />
          <span>Bank it, pay out as a lump sum once off the fixed rate</span>
        </label>
        <label className="radio-field">
          <input
            type="radio"
            name="bankedSavingsDestination"
            checked={form.bankedSavingsDestination === 'keepAsSavings'}
            onChange={() => update('bankedSavingsDestination', 'keepAsSavings')}
          />
          <span>Just keep as savings (no lump sum)</span>
        </label>
      </div>

      {form.bankedSavingsDestination === 'lumpSumEachCycle' &&
        (form.rateAfterFixedTermMode === 'stayOnVariable' || form.rateAfterFixedTermMode === 'hybrid') && (
          <NumberField
            label="Pay out banked savings every"
            suffix="months"
            value={form.savingsPayoutIntervalMonths}
            onChange={(v) => update('savingsPayoutIntervalMonths', v)}
            step="1"
            min="1"
            hint={
              form.rateAfterFixedTermMode === 'hybrid'
                ? "Only applies once hybrid switches onto the variable rate for good: the first payout lands that month, then repeats on this schedule. While it's still cycling through fixed deals, savings pay out at each remortgage instead."
                : "The first payout lands the month your fixed deal ends, then repeats on this schedule — e.g. 3 for every quarter, 6 for twice a year, or 12, 24, etc. for whole years."
            }
          />
        )}

      {form.bankedSavingsDestination === 'lumpSumEachCycle' && form.rateAfterFixedTermMode === 'remortgageToNewFixed' && (
        <p className="field-hint">
          Banked savings pay out automatically each time you remortgage — the month your fixed deal ends, right
          before the follow-on/variable window below — rather than on a fixed calendar schedule.
        </p>
      )}

      {(form.rateAfterFixedTermMode === 'remortgageToNewFixed' || form.rateAfterFixedTermMode === 'hybrid') && (
        <>
          <NumberField
            label="Time to arrange the next fixed deal"
            suffix="months"
            value={form.remortgageGapMonths}
            onChange={(v) => update('remortgageGapMonths', v)}
            step="1"
            hint="Time spent on the follow-on/variable rate between one fixed deal ending and the next one starting — only used while hybrid is still cycling through fixed deals, if that's what's selected above."
          />
          <p className="field-hint">
            UK product transfers with your existing lender can complete in a few working days, but that's for a
            same-balance switch arranged in advance. Since the loan amount changes here (the lump sum is paid
            first), a full remortgage — typically 4–8 weeks — is the more realistic assumption; 2 months is a
            reasonable default.
          </p>
        </>
      )}
    </fieldset>
    </>
  );
}
