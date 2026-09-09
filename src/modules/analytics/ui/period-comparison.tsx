"use client";

/**
 * Comparison of the selected period against the equivalent previous one.
 *
 * Both intervals are stated with their exact civil dates before any percentage
 * is read, because a partial period is compared against the same ordinal days
 * of the previous block: without the dates on screen, a change could be
 * mistaken for a comparison against a whole month.
 *
 * The figures are a table rather than a chart, so a screen reader receives the
 * same values with names instead of a visual description.
 */

import { cx } from "../../../shared/ui/class-names";
import { IncomeExpenseComparison } from "./charts/income-expense-comparison";
import type {
  ComparedPeriodTotalsDto,
  ComparisonDeltaDto,
  ComparisonWindowDto,
} from "../contracts/summary";
import { dashboardCopy } from "./dashboard-copy";
import {
  comparisonChangeLabel,
  formatDateRangeLabel,
  netTone,
  signedSummaryAmount,
  summaryAmount,
  summaryToneClassName,
  type SummaryTone,
} from "./summary-presentation";

/** Identifier of the heading that labels the comparison block. */
export const COMPARISON_TITLE_ID = "dashboard-comparison-title";

export interface PeriodComparisonProps {
  readonly comparison: ComparisonWindowDto;
  readonly totals: ComparedPeriodTotalsDto;
}

interface ComparisonRow {
  readonly concept: string;
  readonly current: string;
  readonly previous: string;
  readonly delta: ComparisonDeltaDto;
  readonly tone: SummaryTone;
}

function comparisonRows(totals: ComparedPeriodTotalsDto): ComparisonRow[] {
  return [
    {
      concept: dashboardCopy.income,
      current: summaryAmount(totals.current.incomeMinor),
      previous: summaryAmount(totals.previous.incomeMinor),
      delta: totals.income,
      tone: "income",
    },
    {
      concept: dashboardCopy.expense,
      current: summaryAmount(totals.current.expenseMinor),
      previous: summaryAmount(totals.previous.expenseMinor),
      delta: totals.expense,
      tone: "expense",
    },
    {
      concept: dashboardCopy.net,
      current: signedSummaryAmount(totals.current.netMinor),
      previous: signedSummaryAmount(totals.previous.netMinor),
      delta: totals.net,
      tone: netTone(totals.current.netMinor),
    },
  ];
}

/** Table of the three figures in both intervals, with their change. */
export function PeriodComparison({
  comparison,
  totals,
}: PeriodComparisonProps) {
  return (
    <section
      aria-labelledby={COMPARISON_TITLE_ID}
      className="flex w-full max-w-full min-w-0 flex-col gap-3"
    >
      <h2
        className="text-heading-sm text-text font-medium"
        id={COMPARISON_TITLE_ID}
      >
        {dashboardCopy.comparisonTitle}
      </h2>
      <p className="text-body-sm text-text-muted">
        {dashboardCopy.comparisonRanges(
          formatDateRangeLabel(comparison.current),
          formatDateRangeLabel(comparison.previous),
        )}
      </p>
      <IncomeExpenseComparison comparison={comparison} totals={totals} />
      <div className="w-full max-w-full min-w-0 overflow-x-auto">
        <table className="w-full max-w-full min-w-0 border-collapse text-left">
          <caption className="sr-only">{dashboardCopy.comparisonTitle}</caption>
          <thead>
            <tr className="border-border text-caption text-text-muted border-b">
              <th className="px-3 py-2 font-medium" scope="col">
                {dashboardCopy.comparisonConcept}
              </th>
              <th className="px-3 py-2 text-right font-medium" scope="col">
                {dashboardCopy.comparisonCurrent}
              </th>
              <th className="px-3 py-2 text-right font-medium" scope="col">
                {dashboardCopy.comparisonPrevious}
              </th>
              <th className="px-3 py-2 text-right font-medium" scope="col">
                {dashboardCopy.comparisonChange}
              </th>
            </tr>
          </thead>
          <tbody>
            {comparisonRows(totals).map((row) => (
              <tr
                className="border-border border-b last:border-b-0"
                key={row.concept}
              >
                <th
                  className="text-body-sm text-text px-3 py-3 font-medium"
                  scope="row"
                >
                  {row.concept}
                </th>
                <td
                  className={cx(
                    "text-body-sm px-3 py-3 text-right font-semibold tabular-nums",
                    summaryToneClassName(row.tone),
                  )}
                >
                  {row.current}
                </td>
                <td className="text-body-sm text-text-muted px-3 py-3 text-right tabular-nums">
                  {row.previous}
                </td>
                <td className="text-body-sm text-text px-3 py-3 text-right tabular-nums">
                  {comparisonChangeLabel(row.delta)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
