import { useRef, useState } from 'react';
import type { MonthlyScheduleEntry } from '../api/types';
import { formatGBP, formatMonthsAsYearsMonths } from '../format';

interface RepaymentBreakdownChartProps {
  /** The actual schedule (with overpayments). Only the scheduled interest + principal is plotted. */
  schedule: MonthlyScheduleEntry[];
}

const WIDTH = 800;
const HEIGHT = 320;
const PAD = { top: 16, right: 16, bottom: 32, left: 72 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

function niceCeil(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => normalized <= s + 1e-9) ?? 10;
  return step * magnitude;
}

export function RepaymentBreakdownChart({ schedule }: RepaymentBreakdownChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (schedule.length === 0) return null;

  const n = schedule.length;
  const maxPayment = niceCeil(Math.max(...schedule.map((e) => e.interestPaid + e.principalPaid)));
  const slot = PLOT_W / n;
  const barW = Math.max(slot * 0.85, 0.5);
  const yFor = (v: number) => PAD.top + PLOT_H - (maxPayment === 0 ? 0 : (v / maxPayment) * PLOT_H);
  const xFor = (i: number) => PAD.left + i * slot + (slot - barW) / 2;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxPayment * f));

  const totalYears = Math.ceil(n / 12);
  const stepYears = totalYears <= 10 ? 1 : totalYears <= 20 ? 2 : 5;
  const xTicks: number[] = [];
  for (let y = 0; y <= totalYears; y += stepYears) xTicks.push(Math.min(y * 12, n));

  const handlePointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xInViewBox = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const idx = Math.floor((xInViewBox - PAD.left) / slot);
    setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
  };

  const hovered = hoverIdx !== null ? schedule[hoverIdx] : null;
  const tooltipWidth = 190;
  const hoverX = hoverIdx !== null ? PAD.left + (hoverIdx + 0.5) * slot : 0;
  const tooltipX = hoverX + 12 + tooltipWidth > WIDTH - PAD.right ? hoverX - 12 - tooltipWidth : hoverX + 12;

  return (
    <details className="card">
      <summary className="chart-summary">Monthly repayments</summary>
      <div className="chart-legend">
        <span className="chart-legend-item">
          <span className="chart-legend-swatch chart-legend-swatch--block chart-legend-swatch--principal" />
          Principal
        </span>
        <span className="chart-legend-item">
          <span className="chart-legend-swatch chart-legend-swatch--block chart-legend-swatch--interest" />
          Interest
        </span>
      </div>
      <p className="field-hint">Based on your actual schedule, so it ends at payoff and reflects any payment recasts. Shows the scheduled payment only — overpayments and lump sums are not included.</p>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="balance-chart"
        role="img"
        aria-label="Monthly mortgage repayment split into interest and principal"
      >
        {yTicks.map((tick, ti) => (
          <g key={ti}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={yFor(tick)} y2={yFor(tick)} className="chart-gridline" />
            <text x={PAD.left - 8} y={yFor(tick)} className="chart-axis-label" textAnchor="end" dominantBaseline="middle">
              {formatGBP(tick)}
            </text>
          </g>
        ))}

        {xTicks.map((month) => (
          <text
            key={month}
            x={PAD.left + (month / n) * PLOT_W}
            y={HEIGHT - PAD.bottom + 20}
            className="chart-axis-label"
            textAnchor="middle"
          >
            {Math.round(month / 12)}y
          </text>
        ))}

        {schedule.map((e, i) => {
          const principalTop = yFor(e.principalPaid);
          const interestTop = yFor(e.principalPaid + e.interestPaid);
          return (
            <g key={e.month} opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.55}>
              <rect
                x={xFor(i)}
                y={principalTop}
                width={barW}
                height={yFor(0) - principalTop}
                className="chart-bar--principal"
              />
              <rect
                x={xFor(i)}
                y={interestTop}
                width={barW}
                height={principalTop - interestTop}
                className="chart-bar--interest"
              />
            </g>
          );
        })}

        {hovered && hoverIdx !== null && (
          <g transform={`translate(${tooltipX}, ${PAD.top})`}>
            <rect width={tooltipWidth} height={82} rx={6} className="chart-tooltip-bg" />
            <text x={10} y={18} className="chart-tooltip-title">
              Month {hovered.month} ({formatMonthsAsYearsMonths(hovered.month)})
            </text>
            <text x={10} y={36} className="chart-tooltip-row">
              Total: <tspan className="chart-tooltip-value">{formatGBP(hovered.interestPaid + hovered.principalPaid)}</tspan>
            </text>
            <text x={10} y={54} className="chart-tooltip-row">
              Principal: <tspan className="chart-tooltip-value">{formatGBP(hovered.principalPaid)}</tspan>
            </text>
            <text x={10} y={72} className="chart-tooltip-row">
              Interest: <tspan className="chart-tooltip-value">{formatGBP(hovered.interestPaid)}</tspan>
            </text>
          </g>
        )}

        <rect
          x={PAD.left}
          y={PAD.top}
          width={PLOT_W}
          height={PLOT_H}
          fill="transparent"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverIdx(null)}
        />
      </svg>
    </details>
  );
}
