import { useState } from 'react';
import type { MonthlyScheduleEntry } from '../engine';
import { formatGBP, formatMonthCompact } from '../format';

interface AmortizationTableProps {
  schedule: MonthlyScheduleEntry[];
}

export function AmortizationTable({ schedule }: AmortizationTableProps) {
  const [expanded, setExpanded] = useState(false);
  const hasSavingsActivity = schedule.some((e) => e.savingsPotBalance > 0 || e.savingsAddedThisMonth > 0);
  const hasLumpSums = schedule.some((e) => e.lumpSumPaid > 0);

  return (
    <div className="card">
      <button type="button" className="disclosure" onClick={() => setExpanded(!expanded)}>
        {expanded ? '▾' : '▸'} Full amortization schedule ({schedule.length} months)
      </button>
      {expanded && (
        <>
          <p className="field-hint">Rows shaded and marked ↷ are the last month of a fixed-rate deal.</p>
          <div className="table-scroll">
            <table className="schedule-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Rate</th>
                  <th>Payment</th>
                  <th>Interest</th>
                  <th>Principal</th>
                  <th>Overpayment</th>
                  {hasLumpSums && <th>Lump sum</th>}
                  {hasSavingsActivity && <th>Savings</th>}
                  {hasSavingsActivity && <th>Saved</th>}
                  <th>ERC</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((e) => {
                  const recurringOverpayment = e.overpaymentPaid - e.lumpSumPaid;
                  return (
                    <tr key={e.month} className={e.isFixedPeriodBoundary ? 'period-boundary' : undefined}>
                      <td>
                        {formatMonthCompact(e.month)}
                        {e.isFixedPeriodBoundary && <span title="Last month of this fixed-rate deal"> ↷</span>}
                      </td>
                      <td>{e.ratePct.toFixed(2)}%</td>
                      <td>{formatGBP(e.scheduledPayment, true)}</td>
                      <td>{formatGBP(e.interestPaid, true)}</td>
                      <td>{formatGBP(e.principalPaid, true)}</td>
                      <td>{recurringOverpayment > 0 ? formatGBP(recurringOverpayment, true) : '–'}</td>
                      {hasLumpSums && <td>{e.lumpSumPaid > 0 ? formatGBP(e.lumpSumPaid, true) : '–'}</td>}
                      {hasSavingsActivity && (
                        <td>{e.savingsAddedThisMonth > 0 ? formatGBP(e.savingsAddedThisMonth, true) : '–'}</td>
                      )}
                      {hasSavingsActivity && <td>{formatGBP(e.savingsPotBalance, true)}</td>}
                      <td>{e.ercCharged > 0 ? formatGBP(e.ercCharged, true) : '–'}</td>
                      <td>{formatGBP(e.closingBalance, true)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
