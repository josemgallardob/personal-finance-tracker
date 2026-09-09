"use client";

/**
 * Visual comparison of income against expense in the two compared intervals.
 *
 * The drawing lives inside the comparison section, next to the table that
 * already states both intervals, both figures and the change between them, so
 * it adds a shape to values that are always available without it. Each bar
 * group is named by its interval, and the legend repeats the semantic colours
 * with their words.
 */

import { cx } from "../../../../shared/ui/class-names";
import type {
  ComparedPeriodTotalsDto,
  ComparisonWindowDto,
} from "../../contracts/summary";
import { dashboardCopy } from "../dashboard-copy";
import { ChartFigure } from "./chart-figure";
import { incomeExpenseBars } from "./chart-series";
import { LazyIncomeExpenseComparisonVisual } from "./lazy-visuals";

export interface IncomeExpenseComparisonProps {
  readonly comparison: ComparisonWindowDto;
  readonly totals: ComparedPeriodTotalsDto;
}

export function IncomeExpenseComparison({
  comparison,
  totals,
}: IncomeExpenseComparisonProps) {
  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-2">
      <ChartFigure name="income-expense">
        <LazyIncomeExpenseComparisonVisual
          bars={incomeExpenseBars(totals, comparison)}
        />
      </ChartFigure>
      <ul
        aria-label={dashboardCopy.comparisonChartLabel}
        className="flex max-w-full flex-wrap gap-4"
      >
        <LegendEntry label={dashboardCopy.income} tone="income" />
        <LegendEntry label={dashboardCopy.expense} tone="expense" />
      </ul>
      <p className="text-caption text-text-muted">
        {dashboardCopy.chartAlternative}
      </p>
    </div>
  );
}

function LegendEntry({
  label,
  tone,
}: {
  readonly label: string;
  readonly tone: "income" | "expense";
}) {
  return (
    <li className="text-body-sm text-text-muted flex items-center gap-2">
      <span
        aria-hidden="true"
        className={cx(
          "inline-block size-3 rounded-full",
          tone === "income" ? "bg-income" : "bg-expense",
        )}
      />
      {label}
    </li>
  );
}
