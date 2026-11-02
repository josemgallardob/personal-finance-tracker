"use client";

/**
 * Monthly evolution of income and expense.
 *
 * The series keeps its own window — up to twelve months ending in the current
 * one — and says so next to the chart, because it is read beside cards that
 * answer a different period and must never look like a consequence of them.
 * Months of the window without movements stay at zero so the axis is not
 * compressed; a workspace with no movement at all shows an empty state instead
 * of a run of zeroes.
 *
 * The drawing is decorative. The table below it carries every figure, and each
 * month opens the history it is made of.
 */

import Link from "next/link";

import { cx } from "../../../../shared/ui/class-names";
import { EmptyState } from "../../../../shared/ui/empty-state";
import type { MonthlyEvolutionDto } from "../../contracts/evolution";
import { dashboardCopy } from "../dashboard-copy";
import { netTone, summaryToneClassName } from "../summary-presentation";
import { ChartFigure } from "./chart-figure";
import { monthlyTrendPoints, monthlyTrendWindowLabel } from "./chart-series";
import { LazyMonthlyTrendVisual } from "./lazy-visuals";

/** Identifier of the heading that labels the evolution section. */
export const MONTHLY_TREND_TITLE_ID = "dashboard-trend-title";

export interface MonthlyTrendProps {
  readonly evolution: MonthlyEvolutionDto;
}

/** Evolution chart with the table that replaces it. */
export function MonthlyTrend({ evolution }: MonthlyTrendProps) {
  const points = monthlyTrendPoints(evolution);

  return (
    <section
      aria-labelledby={MONTHLY_TREND_TITLE_ID}
      className="flex w-full max-w-full min-w-0 flex-col gap-3"
    >
      <h2
        className="text-heading-sm text-text font-medium"
        id={MONTHLY_TREND_TITLE_ID}
      >
        {dashboardCopy.trendTitle}
      </h2>
      {evolution.kind === "empty" ? (
        <EmptyState
          description={dashboardCopy.trendEmptyDescription}
          title={dashboardCopy.trendEmptyTitle}
        />
      ) : (
        <>
          <p className="text-body-sm text-text">
            {monthlyTrendWindowLabel(evolution.window)}
          </p>
          <ChartFigure name="monthly-trend">
            <LazyMonthlyTrendVisual points={points} />
          </ChartFigure>
          <div className="w-full max-w-full min-w-0 overflow-x-auto">
            <table className="w-full max-w-full min-w-0 border-collapse text-left">
              <caption className="text-caption text-text-muted pb-2 text-left">
                {dashboardCopy.trendCaption}
              </caption>
              <thead>
                <tr className="border-border text-caption text-text-muted border-b">
                  <th className="px-3 py-2 font-medium" scope="col">
                    {dashboardCopy.monthColumn}
                  </th>
                  <th className="px-3 py-2 text-right font-medium" scope="col">
                    {dashboardCopy.income}
                  </th>
                  <th className="px-3 py-2 text-right font-medium" scope="col">
                    {dashboardCopy.expense}
                  </th>
                  <th className="px-3 py-2 text-right font-medium" scope="col">
                    {dashboardCopy.net}
                  </th>
                </tr>
              </thead>
              <tbody>
                {points.map((point) => (
                  <tr
                    className="border-border border-b last:border-b-0"
                    key={point.month}
                  >
                    <th
                      className="text-body-sm text-text px-3 py-3 font-medium break-words"
                      scope="row"
                    >
                      {point.href === null ? (
                        point.label
                      ) : (
                        <Link
                          className="focus-visible:outline-primary-bright underline focus-visible:outline-2 focus-visible:outline-offset-2"
                          href={point.href}
                        >
                          {point.label}
                        </Link>
                      )}
                    </th>
                    <td className="text-body-sm text-income px-3 py-3 text-right tabular-nums">
                      {point.incomeLabel}
                    </td>
                    <td className="text-body-sm text-expense px-3 py-3 text-right tabular-nums">
                      {point.expenseLabel}
                    </td>
                    <td
                      className={cx(
                        "text-body-sm px-3 py-3 text-right tabular-nums",
                        summaryToneClassName(netTone(point.netMinor)),
                      )}
                    >
                      {point.netLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
