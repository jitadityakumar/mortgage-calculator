import type { ComparisonResult } from '../engine';
import { formatGBP, formatMonthsAsYearsMonths } from '../format';

interface ResultsSummaryProps {
  comparison: ComparisonResult;
  hasOverpayments: boolean;
}

export function ResultsSummary({ comparison, hasOverpayments }: ResultsSummaryProps) {
  const { withOverpayments, withoutOverpayments, interestSaved, monthsSaved } = comparison;

  return (
    <div className="card results">
      <h2>Results</h2>

      <div className="stat-grid">
        <div className="stat">
          <span className="stat-label">Monthly payment (fixed period)</span>
          <span className="stat-value">{formatGBP(withOverpayments.initialMonthlyPayment, true)}</span>
        </div>
        {withOverpayments.variablePeriodMonthlyPayment > 0 && (
          <div className="stat">
            <span className="stat-label">Monthly payment (after fixed period)</span>
            <span className="stat-value">{formatGBP(withOverpayments.variablePeriodMonthlyPayment, true)}</span>
          </div>
        )}
        <div className="stat">
          <span className="stat-label">Time to pay off</span>
          <span className="stat-value">{formatMonthsAsYearsMonths(withOverpayments.payoffMonth)}</span>
          {hasOverpayments && (
            <span className="stat-delta">
              vs {formatMonthsAsYearsMonths(withoutOverpayments.payoffMonth)} without overpaying
            </span>
          )}
        </div>
        <div className="stat">
          <span className="stat-label">Total repaid</span>
          <span className="stat-value">{formatGBP(withOverpayments.totalRepaid)}</span>
          {hasOverpayments && (
            <span className="stat-delta">vs {formatGBP(withoutOverpayments.totalRepaid)} without overpaying</span>
          )}
        </div>
        <div className="stat">
          <span className="stat-label">Total interest paid</span>
          <span className="stat-value">{formatGBP(withOverpayments.totalInterestPaid)}</span>
          {hasOverpayments && (
            <span className="stat-delta">
              vs {formatGBP(withoutOverpayments.totalInterestPaid)} without overpaying
            </span>
          )}
        </div>
        {withOverpayments.totalErcPaid > 0 && (
          <div className="stat">
            <span className="stat-label">Early Repayment Charges</span>
            <span className="stat-value">{formatGBP(withOverpayments.totalErcPaid)}</span>
          </div>
        )}
      </div>

      {hasOverpayments && (
        <div className="comparison">
          <h3>Effect of your overpayments</h3>
          <table className="comparison-table">
            <thead>
              <tr>
                <th />
                <th>Without overpaying</th>
                <th>With overpaying</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Time to pay off</td>
                <td>{formatMonthsAsYearsMonths(withoutOverpayments.payoffMonth)}</td>
                <td>{formatMonthsAsYearsMonths(withOverpayments.payoffMonth)}</td>
              </tr>
              <tr>
                <td>Total interest paid</td>
                <td>{formatGBP(withoutOverpayments.totalInterestPaid)}</td>
                <td>{formatGBP(withOverpayments.totalInterestPaid)}</td>
              </tr>
              <tr>
                <td>Total repaid</td>
                <td>{formatGBP(withoutOverpayments.totalRepaid)}</td>
                <td>{formatGBP(withOverpayments.totalRepaid)}</td>
              </tr>
            </tbody>
          </table>
          <p className="savings-callout">
            You'd save <strong>{formatGBP(interestSaved)}</strong> in interest and pay off{' '}
            <strong>{formatMonthsAsYearsMonths(monthsSaved)}</strong> earlier.
          </p>
        </div>
      )}

      {withOverpayments.warnings.length > 0 && (
        <ul className="warnings">
          {withOverpayments.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
