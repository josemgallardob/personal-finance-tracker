"use client";

/**
 * Recharts drawings of the dashboard.
 *
 * This module is the only place that imports the chart library, and it is
 * always reached through {@link ./lazy-visuals}, so the library stays out of
 * the first load of a page whose figures are already readable without it.
 *
 * Every drawing here is decorative: it is hidden from assistive technology and
 * carries no value that its section does not also publish as a table or a
 * list. Income keeps the semantic green and expense the semantic red in all of
 * them, and both series are additionally distinguished by shape — a solid and
 * a dashed line in the trend, two named bars elsewhere — so colour is never the
 * only difference between them.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { colorTokens } from "../../../../shared/ui/tokens";
import type {
  BreakdownBar,
  IncomeExpenseBar,
  MonthlyTrendPoint,
} from "./chart-series";

/** Height every drawing reserves, small enough to stay usable at 320 px. */
const CHART_HEIGHT = 220;

/** Minor units become EUR units before they reach an axis of the drawing. */
const MINOR_UNITS_PER_EUR = 100;

function toEurUnits(minor: number): number {
  return minor / MINOR_UNITS_PER_EUR;
}

const axisStyle = {
  fill: colorTokens.textMuted,
  fontSize: 12,
} as const;

/** Line series of income and expense over the months of the evolution window. */
export function MonthlyTrendVisual({
  points,
}: {
  readonly points: readonly MonthlyTrendPoint[];
}) {
  const data = points.map((point) => ({
    label: point.label,
    income: toEurUnits(point.incomeMinor),
    expense: toEurUnits(point.expenseMinor),
  }));

  return (
    <ResponsiveContainer height={CHART_HEIGHT} width="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={colorTokens.border} vertical={false} />
        <XAxis dataKey="label" tick={axisStyle} tickLine={false} />
        <YAxis tick={axisStyle} tickLine={false} width={64} />
        <Line
          dataKey="income"
          dot={{ r: 3 }}
          isAnimationActive={false}
          stroke={colorTokens.income}
          strokeWidth={2}
          type="monotone"
        />
        <Line
          dataKey="expense"
          dot={{ r: 3 }}
          isAnimationActive={false}
          stroke={colorTokens.expense}
          strokeDasharray="6 3"
          strokeWidth={2}
          type="monotone"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Grouped bars of income and expense in the two compared intervals. */
export function IncomeExpenseComparisonVisual({
  bars,
}: {
  readonly bars: readonly IncomeExpenseBar[];
}) {
  const data = bars.map((bar) => ({
    label: bar.label,
    income: toEurUnits(bar.incomeMinor),
    expense: toEurUnits(bar.expenseMinor),
  }));

  return (
    <ResponsiveContainer height={CHART_HEIGHT} width="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={colorTokens.border} vertical={false} />
        <XAxis dataKey="label" tick={axisStyle} tickLine={false} />
        <YAxis tick={axisStyle} tickLine={false} width={64} />
        <Bar
          dataKey="income"
          fill={colorTokens.income}
          isAnimationActive={false}
          radius={[4, 4, 0, 0]}
        />
        <Bar
          dataKey="expense"
          fill={colorTokens.expense}
          isAnimationActive={false}
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars of one expense breakdown, in the order it was received. */
export function BreakdownBarsVisual({
  bars,
}: {
  readonly bars: readonly BreakdownBar[];
}) {
  const data = bars.map((bar) => ({
    id: bar.id,
    label: bar.label,
    total: toEurUnits(bar.totalMinor),
    archived: bar.archived,
  }));

  return (
    <ResponsiveContainer height={CHART_HEIGHT} width="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      >
        <CartesianGrid horizontal={false} stroke={colorTokens.border} />
        <XAxis tick={axisStyle} tickLine={false} type="number" />
        <YAxis
          dataKey="label"
          tick={axisStyle}
          tickLine={false}
          type="category"
          width={96}
        />
        <Bar dataKey="total" isAnimationActive={false} radius={[0, 4, 4, 0]}>
          {data.map((entry) => (
            <Cell
              key={entry.id}
              fill={colorTokens.expense}
              fillOpacity={entry.archived ? 0.55 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
