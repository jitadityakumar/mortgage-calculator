import { useMemo, useState } from 'react';
import { calculateSdlt } from '../engine';
import { formatGBP } from '../format';

interface SdltCalculatorProps {
  propertyValue: number;
  deposit: number;
  isFirstTimeBuyer: boolean;
}

export function SdltCalculator({ propertyValue, deposit, isFirstTimeBuyer }: SdltCalculatorProps) {
  const [expanded, setExpanded] = useState(false);
  const sdlt = useMemo(() => calculateSdlt(propertyValue, isFirstTimeBuyer), [propertyValue, isFirstTimeBuyer]);
  const cashNeededAtCompletion = deposit + sdlt.totalTax;

  return (
    <div className="card">
      <button type="button" className="disclosure" onClick={() => setExpanded(!expanded)}>
        {expanded ? '▾' : '▸'} Stamp Duty Land Tax &amp; total cash to buy (England &amp; NI only)
      </button>
      {expanded && (
        <>
          <div className="stat-grid">
            <div className="stat">
              <span className="stat-label">Stamp Duty Land Tax</span>
              <span className="stat-value">{formatGBP(sdlt.totalTax)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Cash needed at completion (deposit + SDLT)</span>
              <span className="stat-value">{formatGBP(cashNeededAtCompletion)}</span>
            </div>
          </div>

          {sdlt.breakdown.length > 0 && (
            <table className="schedule-table">
              <thead>
                <tr>
                  <th>Band</th>
                  <th>Rate</th>
                  <th>Taxable amount</th>
                  <th>Tax</th>
                </tr>
              </thead>
              <tbody>
                {sdlt.breakdown.map((b) => (
                  <tr key={b.bandLabel}>
                    <td>{b.bandLabel}</td>
                    <td>{b.ratePct}%</td>
                    <td>{formatGBP(b.taxableAmount)}</td>
                    <td>{formatGBP(b.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="field-hint">
            SDLT is a one-off purchase cost, separate from your mortgage repayments — it doesn't
            affect the loan or monthly payment figures above. England &amp; Northern Ireland only:
            Scotland (LBTT) and Wales (LTT) use different taxes and bands. Rates shown are current
            as of April 2025 — verify at gov.uk before relying on this for a real purchase.
          </p>
        </>
      )}
    </div>
  );
}
