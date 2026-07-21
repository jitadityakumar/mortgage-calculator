import { useId, useRef, useState } from 'react';
import type { MonthlyScheduleEntry } from '../engine';
import { formatGBP, formatMonthsAsYearsMonths } from '../format';

interface BalanceChartProps {
  withSchedule: MonthlyScheduleEntry[];
  /** Baseline (no overpayments) schedule, for comparison. Omit to show a single line. */
  withoutSchedule?: MonthlyScheduleEntry[];
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
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Balance at each month, 0..maxMonths, padding with 0 once a schedule ends (paid off). */
function balancesByMonth(schedule: MonthlyScheduleEntry[], maxMonths: number): number[] {
  const points: number[] = [schedule[0]?.openingBalance ?? 0];
  for (let m = 1; m <= maxMonths; m++) {
    points.push(m <= schedule.length ? schedule[m - 1].closingBalance : 0);
  }
  return points;
}

export function BalanceChart({ withSchedule, withoutSchedule }: BalanceChartProps) {
  const gradientId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverMonth, setHoverMonth] = useState<number | null>(null);

  if (withSchedule.length === 0) return null;

  const hasComparison = !!withoutSchedule;
  const maxMonths = Math.max(withSchedule.length, withoutSchedule?.length ?? 0);
  const withPoints = balancesByMonth(withSchedule, maxMonths);
  const withoutPoints = withoutSchedule ? balancesByMonth(withoutSchedule, maxMonths) : null;

  const maxBalance = niceCeil(Math.max(withPoints[0], withoutPoints?.[0] ?? 0));

  const xFor = (month: number) => PAD.left + (month / maxMonths) * PLOT_W;
  const yFor = (balance: number) => PAD.top + PLOT_H - (maxBalance === 0 ? 0 : (balance / maxBalance) * PLOT_H);

  const pathFor = (points: number[]) =>
    points.map((balance, month) => `${month === 0 ? 'M' : 'L'} ${xFor(month).toFixed(1)} ${yFor(balance).toFixed(1)}`).join(' ');

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxBalance * f));

  const totalYears = Math.ceil(maxMonths / 12);
  const xTickStepYears = totalYears <= 10 ? 1 : totalYears <= 20 ? 2 : 5;
  const xTicks: number[] = [];
  for (let y = 0; y <= totalYears; y += xTickStepYears) {
    xTicks.push(Math.min(y * 12, maxMonths));
  }

  const handlePointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xInViewBox = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const month = Math.round(((xInViewBox - PAD.left) / PLOT_W) * maxMonths);
    setHoverMonth(Math.max(0, Math.min(maxMonths, month)));
  };

  const hoveredWith = hoverMonth !== null ? withPoints[hoverMonth] : null;
  const hoveredWithout = hoverMonth !== null && withoutPoints ? withoutPoints[hoverMonth] : null;

  // Keep the tooltip box on-screen by flipping it to the left of the crosshair
  // once there isn't room to the right.
  const tooltipWidth = 190;
  const hoverX = hoverMonth !== null ? xFor(hoverMonth) : 0;
  const tooltipX = hoverX + 12 + tooltipWidth > WIDTH - PAD.right ? hoverX - 12 - tooltipWidth : hoverX + 12;

  return (
    <div className="card">
      <h2>Balance over time</h2>
      {hasComparison && (
        <div className="chart-legend">
          <span className="chart-legend-item">
            <span className="chart-legend-swatch chart-legend-swatch--with" />
            With overpayments
          </span>
          <span className="chart-legend-item">
            <span className="chart-legend-swatch chart-legend-swatch--without" />
            Without overpayments
          </span>
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="balance-chart"
        role="img"
        aria-label="Outstanding mortgage balance over the life of the loan"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={yFor(tick)}
              y2={yFor(tick)}
              className="chart-gridline"
            />
            <text x={PAD.left - 8} y={yFor(tick)} className="chart-axis-label" textAnchor="end" dominantBaseline="middle">
              {formatGBP(tick)}
            </text>
          </g>
        ))}

        {xTicks.map((month) => (
          <text key={month} x={xFor(month)} y={HEIGHT - PAD.bottom + 20} className="chart-axis-label" textAnchor="middle">
            {Math.round(month / 12)}y
          </text>
        ))}

        {withoutPoints && (
          <path d={pathFor(withoutPoints)} className="chart-line chart-line--without" fill="none" />
        )}
        <path d={`${pathFor(withPoints)} L ${xFor(maxMonths).toFixed(1)} ${yFor(0).toFixed(1)} L ${xFor(0).toFixed(1)} ${yFor(0).toFixed(1)} Z`} fill={`url(#${gradientId})`} stroke="none" />
        <path d={pathFor(withPoints)} className="chart-line chart-line--with" fill="none" />

        {hoverMonth !== null && (
          <g>
            <line x1={xFor(hoverMonth)} x2={xFor(hoverMonth)} y1={PAD.top} y2={HEIGHT - PAD.bottom} className="chart-crosshair" />
            {hoveredWithout !== null && (
              <circle cx={xFor(hoverMonth)} cy={yFor(hoveredWithout)} r={4} className="chart-dot chart-dot--without" />
            )}
            {hoveredWith !== null && (
              <circle cx={xFor(hoverMonth)} cy={yFor(hoveredWith)} r={4} className="chart-dot chart-dot--with" />
            )}
            <g transform={`translate(${tooltipX}, ${PAD.top})`}>
              <rect width={tooltipWidth} height={hasComparison ? 64 : 44} rx={6} className="chart-tooltip-bg" />
              <text x={10} y={18} className="chart-tooltip-title">
                {formatMonthsAsYearsMonths(hoverMonth)}
              </text>
              {hoveredWith !== null && (
                <text x={10} y={36} className="chart-tooltip-row">
                  With: <tspan className="chart-tooltip-value">{formatGBP(hoveredWith)}</tspan>
                </text>
              )}
              {hoveredWithout !== null && (
                <text x={10} y={54} className="chart-tooltip-row">
                  Without: <tspan className="chart-tooltip-value">{formatGBP(hoveredWithout)}</tspan>
                </text>
              )}
            </g>
          </g>
        )}

        <rect
          x={PAD.left}
          y={PAD.top}
          width={PLOT_W}
          height={PLOT_H}
          fill="transparent"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverMonth(null)}
        />
      </svg>
    </div>
  );
}
